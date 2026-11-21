import re
import unittest
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parents[1]

class Elements(HTMLParser):
    def __init__(self):super().__init__();self.elements=[]
    def handle_starttag(self,tag,attrs):self.elements.append((tag,dict(attrs)))

class MinimalUiTests(unittest.TestCase):
    def test_minimal_panel_and_all_three_difficulties_exist(self):
        p=Elements();p.feed((ROOT/'index.html').read_text(encoding='utf-8'))
        ids=[a['id'] for _,a in p.elements if 'id' in a]
        self.assertIn('panel',ids);self.assertEqual(len(ids),len(set(ids)))
        self.assertEqual({a['data-difficulty'] for _,a in p.elements if 'data-difficulty' in a},{'easy','normal','hard'})
        self.assertNotIn('hit-pad',ids)

    def test_completion_preserves_playback_and_does_not_auto_submit(self):
        source=(ROOT/'app.mjs').read_text(encoding='utf-8')
        match=re.search(r'function finishGame\(\)\s*\{(.*?)\n\}\n',source,re.S)
        self.assertIsNotNone(match,'completion transition should be independently reviewable')
        self.assertNotIn('player.pause',match.group(1))
        self.assertNotIn('audioEngine.stop',match.group(1))
        self.assertNotIn('boards.submit',match.group(1))

    def test_result_has_retry_difficulty_and_explicit_rank_submission_actions(self):
        html=(ROOT/'index.html').read_text(encoding='utf-8')
        for id in ['retry','choose','submit-score','rank-list','result-score','result-grade']:
            self.assertIn('id="'+id+'"',html)

    def test_keyboard_focus_and_persisted_navigation_are_handled(self):
        source=(ROOT/'app.mjs').read_text(encoding='utf-8')
        self.assertIn("'pageshow'",source)
        self.assertIn('event.persisted',source)
        self.assertIn('.blur()',source)

    def test_title_highlights_only_the_x_call_and_response_prefix(self):
        html=(ROOT/'index.html').read_text(encoding='utf-8')
        self.assertIn('X X XXXTERFUSION · 记忆复奏',html)
        self.assertIn('<span class="title-highlight">X X XXX</span>TERFUSION',html)
        self.assertIn('.title-highlight',(ROOT/'style.css').read_text(encoding='utf-8'))

    def test_calibration_has_its_own_entry_and_never_plays_hit_feedback(self):
        html=(ROOT/'index.html').read_text(encoding='utf-8')
        self.assertIn('id="calibrate"',html)
        self.assertIn('id="calibration"',html)
        source=(ROOT/'app.mjs').read_text(encoding='utf-8')
        match=re.search(r'function calibrationStrike\(\)\s*\{(.*?)\n\}\n',source,re.S)
        self.assertIsNotNone(match)
        self.assertNotIn('playHit',match.group(1))
        self.assertNotIn('inputOffsetMs',match.group(1))

    def test_hit_volume_controls_sound_hint_and_result_lock_exist(self):
        html=(ROOT/'index.html').read_text(encoding='utf8')
        for id in ['hit-volume','game-hit-volume','toy-sound-notice','result-lock-note']:
            self.assertIn('id="'+id+'"',html)
        self.assertIn('右上角',html)
        app=(ROOT/'app.mjs').read_text(encoding='utf8')
        self.assertIn('resultUnlockAt',app)
        self.assertIn('isResultLocked()',app)
        self.assertIn('hitVolume:',app)

if __name__=='__main__':unittest.main()
