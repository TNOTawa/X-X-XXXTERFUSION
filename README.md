# X X XXXTERFUSION

基于 **Bilibili Toy 半屏视频联动**的记忆复奏小游戏。听一段示范，再用点击补上应答鼓点；视频负责画面、谱面与无应答伴奏，Toy 只负责输入、判定和命中音效。

线上体验：<https://www.bilibili.com/toy/X-X-XXX-TERFUSION/index.html>。请使用支持播放器联动的最新版 B站 App，从配套视频入口进入半屏 Toy；普通浏览器不能替代原生播放器桥。

> **本仓库仅开源代码，不附原曲、PV、社区 MIDI、真实扒谱/采样数据、字体或可直接上传的成品 ZIP。** 测试使用独立生成的合成谱面。音乐、视频及相关素材不适用代码的 MIT 许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 玩法与实现

- 简单/普通/硬核三档，示例产品对应18/66/162次击打；硬核含快速跟拍。
- 全面板触摸，支持双指交替；键盘可用 Space / F / J。
- 首个应答允许提前100ms，保留真实负误差；不对输入做节拍吸附。
- 舞萌启发的简化达成率：全部 Critical Perfect 且无多打为101.0000%，等级C至SSS+；并非原作完整BREAK计分复刻。
- 宿主时钟使用 SDK 的 position/rate/timestamp 插值，暂停和缓冲时停止判定。
- 轻微时钟修正容差：一般750ms；起播/缓冲恢复1500ms。大幅跳转或变速转为练习；这是体验折中，不是竞技级防作弊。
- 连续30拍延迟校准，只定位一次，可中途加入；不足或不稳定的结果不覆盖旧补偿。周期信号有半拍歧义，大延迟设备可先手动填粗值。
- 鼓点默认150%，可调0–300%并保存在本机；Toy面板禁音须由玩家在右上角开启，不等于视频静音。
- 结算后视频继续，操作按钮有1.2秒防误触保护。三档榜位独立，成绩仅由用户主动提交，不轮询。

## 环境

- Node.js22或更新版本：核心测试零npm运行依赖。
- Python3.10+，`python -m pip install -r requirements.txt`。
- 本地素材处理需FFmpeg/FFprobe在PATH中；可选视频编辑使用Hyperframes0.9.52。

## 不带素材也能运行的测试

```sh
npm test
python -m unittest discover -s tests -p 'test_*.py'
```

核心、判定、校准、音量、排行榜、打包与视频生成测试使用 `tests/fixtures/chart.json` 和临时合成音频，不读取受版权保护的音乐。真实社区MIDI一致性检查仅在本地配置或 `XTERFUSION_MIDI` 指向已有文件时运行，否则明确跳过。

## 自行准备合法素材

1. 将 `media.example.json` 复制为 `media.local.json`，按需填写路径。建议把输入放在被忽略的 `media/` 下；不要提交个人路径配置。
2. 准备有权使用的源视频、MIDI、无应答伴奏和鼓点分离音频。
3. 生成本地数据：

```sh
python tools/extract_chart.py ./media/input.mid
python tools/align_media.py ./media/input.mp4
python tools/prepare_audio.py
python tools/build_toy.py
```

**提取器针对本实验的MIDI轨名与段落编写，并非任意歌曲的通用扒谱器。** 换曲需调整提取规则/时间段；校准节拍和视频覆盖时间也需同步适配。也可以自行编写符合示例结构的谱面。

生成文件均留在被忽略的 `data/`、`dist/` 中；没有本地素材时打包会明确报缺失，不会生成一个假可玩的包。见 [data/README.md](data/README.md)。

## 本地调试与正式Toy

```sh
python server.py --port 8765
```

打开 `http://127.0.0.1:8765`。服务只监听本机并按白名单读取资源；本地上方视频仅用于调试。请使用已替换伴奏的成片，否则原视频中的应答鼓点可能和命中音叠加。

`python tools/build_toy.py` 输出 `dist/toy/` 和 `dist/X-X-XXXTERFUSION-toy.zip`。发布包：

- 从HTML中直接移除内嵌播放器；失败时也不会出现第二个播放器。
- 将开发用`.mjs`转换为发布用`.js`，并改写全部模块引用，规避已遇到的线上`.mjs`404。
- 不包含完整伴奏/PV，只含本地生成的命中采样及运行数据。
- 不支持原生播放器能力的环境禁用开始/校准，并给出换环境提示。
- 启动显示阶段；脚本失败或超时有明确提示。

**不要上传源码目录，也不要将含媒体的发布ZIP上传GitHub。** Toy的预览、审核、视频绑定与真机检查见 [部署说明](docs/TOY-DEVICE-TEST.md)。

## 可选视频谱面

`tools/build_video.py` 按MIDI拍位生成Hyperframes工程：左侧示范X、右侧应答X、短竖判定线，硬核镜像仍只需一次击打。流速随BPM变化，每四分音符480px。

使用前自行按各自许可准备 `video/assets/source.mp4`、`backing.wav`、GSAP浏览器构建与 `video/fonts/` 中所需字体。工程HTML、透明覆盖层、成片和字体都不提交。现有脚本保持原时间轴，不在开头插入时长；FFmpeg仅负责本地合成和封装。

## 源码结构

- `app.mjs`：极简面板、游戏/校准/结算流程。
- `core.mjs` / `scoring.mjs`：时钟、音符状态、判定和达成率。
- `player.mjs`：原生SDK与本地视频适配。
- `sample-audio.mjs` / `calibration.mjs`：命中采样、音量与校准。
- `leaderboard.mjs`：分难度榜位、个人最佳及显式提交。
- `tools/`：素材处理、视频覆盖层生成、发布包和公开索引审计。
- `tests/`：无原曲依赖的单元/集成测试；浏览器测试是可选的本地素材验收。

## 开源发布保护

`.gitignore` 排除本机配置、媒体、真实谱面/采样元数据、封面、发布包、浏览器资料、字体和缓存。公开提交前运行：

```sh
python tools/audit_public.py
```

审计读取 **Git索引中实际将提交的内容**，拒绝媒体/归档、个人目录绝对路径和常见凭据模式；不会把疑似凭据本身打印到报告中。它不能代替人工审查或素材权利确认。公共CI只运行合成数据测试，不下载原曲或接触B站账号。

代码采用 [MIT](LICENSE) 许可。Bilibili Toy SDK、Hyperframes、GSAP与素材版权保持各自归属；本项目与原游戏及音乐作者无官方隶属关系。
