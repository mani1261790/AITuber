"""Run with pypdf/reportlab installed. Generates an embedded H.264/AAC PDF 2.0 fixture."""
from pathlib import Path
import subprocess,sys
from reportlab.pdfgen import canvas
from pypdf import PdfReader,PdfWriter
from pypdf.generic import DictionaryObject as D, NameObject as N, ArrayObject as A, FloatObject as F, TextStringObject as T, DecodedStreamObject
out=Path(sys.argv[1] if len(sys.argv)>1 else 'output/pdf-media');out.mkdir(parents=True,exist_ok=True)
video=out/'motion.mp4'
subprocess.run(['ffmpeg','-y','-v','error','-f','lavfi','-i',"color=c=0xEDF3FA:s=640x360:r=30:d=18,drawgrid=w=80:h=60:t=1:c=0xc5d1df,drawbox=x=280:y=140:w=80:h=80:c=0x2563eb:t=fill,rotate=0.2*sin(t):fillcolor=0xEDF3FA",'-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=18','-af','volume=0.08','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',str(video)],check=True)
base=out/'static.pdf';c=canvas.Canvas(str(base),pagesize=(960,540))
for i in range(2):
 c.setFillColorRGB(.06,.12,.22);c.rect(0,0,960,540,fill=1,stroke=0);c.setFillColorRGB(1,1,1);c.setFont('Helvetica-Bold',32);c.drawString(54,475,'PDF 2.0 / Video and narration')
 c.setFont('Helvetica',18);c.drawString(54,435,f'Page {i+1} - Embedded H.264 video / AAC audio')
 c.setFillColorRGB(.9,.94,.98);c.rect(80,70,640,360,fill=1,stroke=0);c.setFillColorRGB(.15,.25,.4);c.setFont('Helvetica',25);c.drawString(260,235,'Video preview');c.showPage()
c.save();w=PdfWriter();w.pdf_header='%PDF-2.0'
for page in PdfReader(base).pages:w.add_page(page)
stream=DecodedStreamObject();stream.set_data(video.read_bytes());stream[N('/Type')]=N('/EmbeddedFile');stream[N('/Subtype')]=N('/video/mp4');sr=w._add_object(stream)
fs=w._add_object(D({N('/Type'):N('/Filespec'),N('/F'):T('motion.mp4'),N('/UF'):T('motion.mp4'),N('/EF'):D({N('/F'):sr})}))
instance=w._add_object(D({N('/Type'):N('/RichMediaInstance'),N('/Subtype'):N('/Video'),N('/Asset'):fs}))
config=w._add_object(D({N('/Type'):N('/RichMediaConfiguration'),N('/Subtype'):N('/Video'),N('/Instances'):A([instance])}))
content=w._add_object(D({N('/Assets'):D({N('/Names'):A([T('motion.mp4'),fs])}),N('/Configurations'):A([config])}))
for i,page in enumerate(w.pages):
 annotation=D({N('/Type'):N('/Annot'),N('/Subtype'):N('/RichMedia'),N('/Rect'):A([F(n) for n in [80,70,720,430]]),N('/NM'):T(f'video-{i+1}'),N('/Contents'):T('Embedded motion demo'),N('/RichMediaContent'):content})
 page[N('/Annots')]=A([w._add_object(annotation)])
w.write(out/'video-slides.pdf');print(out/'video-slides.pdf')

# Keep the package source hash tied to the generated PDF.
import json,hashlib
course=json.loads((Path(__file__).resolve().parents[1]/'fixtures/pdf-media/course.json').read_text())
course['sources'][0]['contentHash']='sha256:'+hashlib.sha256((out/'video-slides.pdf').read_bytes()).hexdigest()
(out/'course.json').write_text(json.dumps(course,ensure_ascii=False,indent=2))
