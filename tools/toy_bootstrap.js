// Classic inline startup guard: it must not depend on loading the module graph.
(function () {
  var timer, phase = '入口脚本', done = false, failed = false;
  function node(id) { return document.getElementById(id); }
  var boot = {
    setPhase: function (message) {
      if (done || failed) return;
      phase = message;
      node('loading').textContent = message;
      document.body.dataset.boot = 'loading';
    },
    fail: function (message) {
      if (done || failed) return;
      failed = true;
      clearTimeout(timer);
      document.body.dataset.boot = 'failed';
      node('loading').textContent = '启动失败 · 请重新打开或刷新页面';
      node('error').hidden = false;
      node('error').textContent = message + '（修复版20261121-r3）';
      var buttons = document.querySelectorAll('[data-difficulty], #calibrate');
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
    },
    ready: function () {
      if (failed) return false;
      done = true;
      clearTimeout(timer);
      document.body.dataset.boot = 'ready';
      return true;
    }
  };
  window.__toyBoot = boot;
  timer = setTimeout(function () {
    boot.fail('启动超时：' + phase + '。请检查网络并从最新版B站App的视频入口重新打开半屏Toy；若仍失败，请将本提示反馈作者。');
  }, 30000);
  window.addEventListener('error', function (event) {
    if (event.target && event.target.tagName === 'SCRIPT') {
      boot.fail('页面脚本资源加载失败。请重新打开；若仍失败，请作者检查发布包中的JS资源是否能访问。');
    } else if (event.message) {
      boot.fail('页面启动异常：' + event.message);
    }
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    boot.fail('页面启动异常：' + (event.reason && event.reason.message || '资源或播放器连接未完成'));
  });
}());
