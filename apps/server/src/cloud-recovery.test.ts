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
