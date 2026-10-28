import { describe,it,expect,vi } from 'vitest';
import { LectureEventStore } from '@aituber/storage';
import { FixedLectureService } from './fixed-lecture-service';
import { ClassroomRegistry } from './classroom-registry';
import { quadraticFunctionsFixture as course } from '@aituber/content';

describe('cloud runtime recovery',()=>{
  it('retains completed units and invalidates old audio after restart',()=>{
    vi.useFakeTimers();const store=new LectureEventStore(':memory:');const first=new FixedLectureService({store,playbackUnitMs:100});
    const session=first.createSession({coursePackageId:course.id,durationMinutes:6});vi.advanceTimersByTime(100);
    const checkpoint=first.exportCheckpoint()!;first.close();
    const second=new FixedLectureService({store,playbackUnitMs:100});
    expect(second.restoreCheckpoint(checkpoint)).toBe(true);
    expect(second.getSession(session.id).completedUnitIds).toEqual(checkpoint.state.completedUnitIds);
    expect(second.getSession(session.id).epoch).toBeGreaterThan(checkpoint.state.epoch);
    expect(second.getSession(session.id).speech.playing).toBe(false);
    second.command(session.id,{command:'resume'});expect(second.getSession(session.id).status).toBe('TEACHING');
    second.close();store.close();vi.useRealTimers();
  });
  it('preserves an operator pause and participant reconnect tokens',()=>{
    const store=new LectureEventStore(':memory:');const first=new FixedLectureService({store});const session=first.createSession({coursePackageId:course.id,durationMinutes:6});first.command(session.id,{command:'pause'});const checkpoint=first.exportCheckpoint()!;first.close();
    const second=new FixedLectureService({store});expect(second.restoreCheckpoint(checkpoint)).toBe(false);expect(second.getSession(session.id).status).toBe('PAUSED');
    const rooms=new ClassroomRegistry();const room=rooms.create(session.id);const joined=rooms.join(room.code);const restored=new ClassroomRegistry();restored.restoreState(rooms.exportState());expect(restored.authenticate(room.code,joined.participant.accessToken).sessionId).toBe(session.id);
    expect(()=>restored.authenticate(room.code,'invalid')).toThrow();second.close();store.close();
  });
});

it('keeps the latest published course while restoring a lesson pinned to an older version',()=>{
 const store=new LectureEventStore(':memory:');const first=new FixedLectureService({store,waitForClassroom:true});const session=first.createSession({coursePackageId:course.id,durationMinutes:6});const saved=first.exportCheckpoint()!;first.close();
 const second=new FixedLectureService({store,waitForClassroom:true});const latest={...structuredClone(course),version:course.version+1,title:'Updated package'};second.registerCourse(latest);second.restoreCheckpoint(saved);
 expect(second.getCourse(course.id)).toEqual(latest);expect(second.getSession(session.id).course.version).toBe(course.version);second.close();store.close();
});

it('freezes the lecture time budget during a long pause and across restart',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
 const store=new LectureEventStore(':memory:');const first=new FixedLectureService({store,playbackUnitMs:100_000});
 const session=first.createSession({coursePackageId:course.id,durationMinutes:6});vi.advanceTimersByTime(10_000);
 first.command(session.id,{command:'pause'});const remaining=first.getRemainingTimeMs(session.id);const saved=first.exportCheckpoint()!;
 vi.advanceTimersByTime(3_600_000);expect(first.getRemainingTimeMs(session.id)).toBe(remaining);first.close();
 const second=new FixedLectureService({store,playbackUnitMs:100_000});second.restoreCheckpoint(saved);expect(second.getRemainingTimeMs(session.id)).toBe(remaining);
 second.command(session.id,{command:'resume'});vi.advanceTimersByTime(1_000);expect(second.getRemainingTimeMs(session.id)).toBe(remaining-1_000);
 second.close();store.close();vi.useRealTimers();
});
it('migrates legacy paused checkpoints from pause/resume events without counting pauses twice',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
 const store=new LectureEventStore(':memory:');const first=new FixedLectureService({store,playbackUnitMs:100_000});
 const session=first.createSession({coursePackageId:course.id,durationMinutes:6});vi.advanceTimersByTime(10_000);first.command(session.id,{command:'pause'});vi.advanceTimersByTime(60_000);first.command(session.id,{command:'resume'});vi.advanceTimersByTime(10_000);first.command(session.id,{command:'pause'});
 const saved={...first.exportCheckpoint()!,startedAtMs:Date.parse('2026-10-28T00:00:00Z'),pausedAtMs:undefined};first.close();vi.advanceTimersByTime(3_600_000);
 const second=new FixedLectureService({store});second.restoreCheckpoint(saved);expect(second.getRemainingTimeMs(session.id)).toBe(340_000);const migrated=second.exportCheckpoint()!;second.close();
 const third=new FixedLectureService({store});third.restoreCheckpoint(migrated);expect(third.getRemainingTimeMs(session.id)).toBe(340_000);third.close();store.close();vi.useRealTimers();
});
