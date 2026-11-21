import importlib,unittest
try: module=importlib.import_module('tools.composite_video')
except ModuleNotFoundError:module=None
class CompositeTests(unittest.TestCase):
 def test_00_local_compositor_exists(self):self.assertTrue(callable(getattr(module,'build_command',None)))
 @unittest.skipIf(module is None,'compositor unavailable')
 def test_overlay_is_shifted_but_original_video_and_backing_are_not(self):
  command=module.build_command('ffmpeg','source.mp4','backing.wav','out.mp4',gpu=False)
  self.assertEqual(command.count('libvpx-vp9'),2)
  self.assertIn('source.mp4',command);self.assertIn('backing.wav',command)
  self.assertNotIn('-itsoffset',command)
  self.assertIn('PTS-STARTPTS+74/TB',command[command.index('-filter_complex')+1])
  self.assertIn('3:a:0',command)
if __name__=='__main__':unittest.main()
