import importlib,json,unittest
from pathlib import Path
try: video=importlib.import_module('tools.build_video')
except ModuleNotFoundError:video=None
ROOT=Path(__file__).resolve().parents[1]
class VideoTests(unittest.TestCase):
 def test_00_video_generator_exists(self):self.assertTrue(callable(getattr(video,'overlay_events',None)),'MIDI-driven Hyperframes generator missing')
 @unittest.skipIf(video is None,'generator unavailable')
 def test_echo_sides_and_hard_mirrors_share_the_same_hit_time(self):
  chart=json.loads((ROOT/'tests/fixtures/chart.json').read_text(encoding='utf-8'));events=video.overlay_events(chart,14)
  self.assertEqual(len(events),324)
  self.assertEqual(len([e for e in events if e['kind']=='demo']),66)
  self.assertEqual(len([e for e in events if e['kind']=='answer']),66)
  hard=[e for e in events if e['kind']=='stream'];self.assertEqual(len(hard),192)
  for id in {e['sourceId'] for e in hard}:
   pair=[e for e in hard if e['sourceId']==id];self.assertEqual({e['side'] for e in pair},{'left','right'});self.assertEqual(pair[0]['due'],pair[1]['due'])
  first=min(e['due'] for e in events if e['kind']=='answer');self.assertAlmostEqual(first,(chart['rounds'][0]['answerStartMs']+14)/1000,places=5)
 @unittest.skipIf(video is None,'generator unavailable')
 def test_intro_does_not_shift_video_and_title_is_only_prefix_highlighted(self):
  chart=json.loads((ROOT/'tests/fixtures/chart.json').read_text(encoding='utf-8'));html=video.composition_html(chart,14,offset=0,duration=170,background=True)
  self.assertIn('data-duration="170"',html)
  self.assertIn('最新版哔哩哔哩 App',html)
  self.assertIn('<span class="highlight">X X XXX</span>TERFUSION',html)
  self.assertIn('center-line',html)
  self.assertNotIn('Date.now(',html)
 def test_first_instruction_requires_latest_app_and_half_screen_toy(self):
  chart=json.loads((ROOT/'tests/fixtures/chart.json').read_text(encoding='utf-8'))
  html=video.composition_html(chart)
  first=html.split('id="intro-1"')[1].split('id="intro-2"')[0]
  self.assertIn('最新版哔哩哔哩 App',first)
  self.assertIn('配套半屏 Toy',first)
  self.assertIn('普通播放无法进行互动',first)
 def test_lane_and_notes_are_larger_and_judgement_line_translucent(self):
  chart=json.loads((ROOT/'tests/fixtures/chart.json').read_text(encoding='utf-8'));html=video.composition_html(chart)
  self.assertIn('height:270px',html);self.assertIn('font-size:80px',html)
  self.assertIn('height:140px;background:rgba(233,237,239,.45)',html)
 def test_beat_time_conversion_and_constant_beat_spacing(self):
  self.assertTrue(callable(getattr(video,'beat_at_time',None)), 'beat-space scrolling conversion missing')
  chart={'ticksPerBeat':96,'tempoMap':[{'tick':0,'midiMs':0,'bpm':120},{'tick':384,'midiMs':2000,'bpm':240}]}
  for time in [0,1,1.9,2,2.1,3]:
   self.assertAlmostEqual(video.time_at_beat(chart,video.beat_at_time(chart,time)),time)
  self.assertEqual(video.beat_at_time(chart,2),4)
  self.assertEqual(video.beat_at_time(chart,3),8)
  self.assertEqual(video.PIXELS_PER_BEAT,480)
  self.assertAlmostEqual((video.beat_at_time(chart,2.25)-video.beat_at_time(chart,2))*480,480)
  self.assertAlmostEqual((video.beat_at_time(chart,1.25)-video.beat_at_time(chart,1))*480,240)
 def test_travel_splits_at_tempo_change_without_position_jump(self):
  self.assertTrue(callable(getattr(video,'travel_segments',None)), 'tempo-aware continuous path missing')
  chart={'ticksPerBeat':96,'tempoMap':[{'tick':0,'midiMs':0,'bpm':120},{'tick':384,'midiMs':2000,'bpm':240}]}
  segments=video.travel_segments(chart,2.25,0)
  self.assertEqual(len(segments),2)
  self.assertAlmostEqual(segments[0]['startX'],880)
  self.assertAlmostEqual(segments[0]['end'],2)
  self.assertAlmostEqual(segments[0]['endX'],480)
  self.assertAlmostEqual(segments[1]['startX'],480)
  self.assertAlmostEqual(segments[1]['endX'],0)
  self.assertAlmostEqual(segments[1]['end'],2.25)
  speed1=(segments[0]['startX']-segments[0]['endX'])/(segments[0]['end']-segments[0]['start'])
  speed2=(segments[1]['startX']-segments[1]['endX'])/(segments[1]['end']-segments[1]['start'])
  self.assertAlmostEqual(speed2,2*speed1)
 def test_every_glyph_reaches_its_unchanged_due_time_continuously(self):
  chart=json.loads((ROOT/'tests/fixtures/chart.json').read_text(encoding='utf-8'))
  for event in video.overlay_events(chart,14):
   segments=video.travel_segments(chart,event['due'],14)
   self.assertAlmostEqual(segments[0]['startX'],880,places=4)
   self.assertAlmostEqual(segments[-1]['endX'],0,places=5)
   self.assertEqual(segments[-1]['end'],event['due'])
   for first,second in zip(segments,segments[1:]):
    self.assertEqual(first['end'],second['start'])
    self.assertEqual(first['endX'],second['startX'])
if __name__=='__main__':unittest.main()
