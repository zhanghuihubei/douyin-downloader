// Popup UI 控制脚本

// 检查标签页是否有可用的content script
async function isContentScriptReady(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return true;
  } catch (error) {
    return false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // 初始化UI
  await updateStatus();
  
  // 绑定事件
  document.getElementById('scanNow').addEventListener('click', scanNow);
  document.getElementById('toggleAuto').addEventListener('click', toggleAutoDownload);
  document.getElementById('stopDownload').addEventListener('click', stopDownload);
  document.getElementById('openManage').addEventListener('click', openManage);
  document.getElementById('openDouyin').addEventListener('click', openDouyin);
  document.getElementById('checkInterval').addEventListener('change', changeInterval);
  
  // 定时更新状态
  setInterval(updateStatus, 2000);
  
  // Chrome扩展弹出窗口失去焦点时会被关闭，所以不需要这些事件
  // 每次打开弹出窗口都是新的实例，会重新初始化
});

// 更新状态显示
async function updateStatus() {
  try {
    console.log('🔄 正在更新状态...');
    const response = await chrome.runtime.sendMessage({ action: 'getStatus' });
    
    if (response.success) {
      const { status } = response;
      console.log('📊 收到状态:', {
        isDownloading: status.isDownloading,
        queueLength: status.queueLength,
        downloadedCount: status.downloadedCount
      });
      
      // 更新自动下载状态
      const autoStatus = document.getElementById('autoStatus');
      if (status.autoDownload) {
        autoStatus.textContent = '已启用 ✓';
        autoStatus.className = 'status-value active';
        document.getElementById('toggleAuto').innerHTML = '⏸️ 暂停自动下载';
        document.getElementById('toggleAuto').className = 'btn btn-danger';
      } else {
        autoStatus.textContent = '已暂停';
        autoStatus.className = 'status-value inactive';
        document.getElementById('toggleAuto').innerHTML = '▶️ 启动自动下载';
        document.getElementById('toggleAuto').className = 'btn btn-success';
      }
      
      // 更新下载队列
      document.getElementById('queueLength').textContent = status.queueLength;
      
      // 更新已下载数量
      document.getElementById('downloadedCount').textContent = status.downloadedCount;
      
      // 更新上次检查时间
      if (status.lastCheckTime) {
        const lastCheck = new Date(status.lastCheckTime);
        const now = new Date();
        const diff = Math.floor((now - lastCheck) / 1000 / 60); // 分钟
        
        if (diff < 1) {
          document.getElementById('lastCheck').textContent = '刚刚';
        } else if (diff < 60) {
          document.getElementById('lastCheck').textContent = `${diff}分钟前`;
        } else {
          const hours = Math.floor(diff / 60);
          document.getElementById('lastCheck').textContent = `${hours}小时前`;
        }
      } else {
        document.getElementById('lastCheck').textContent = '从未';
      }
      
      // 停止按钮：总是显示，但只在有下载或队列时启用
      const stopButton = document.getElementById('stopDownload');
      const stopButtonContainer = document.getElementById('stopButtonContainer');
      const shouldEnableStopButton = status.isDownloading || status.queueLength > 0;
      
      stopButton.disabled = !shouldEnableStopButton;
      stopButtonContainer.style.display = 'block';
      
      // 根据状态更新按钮文本
      if (status.isDownloading) {
        stopButton.innerHTML = '🛑 停止下载中...';
        stopButton.className = 'btn btn-danger';
      } else if (status.queueLength > 0) {
        stopButton.innerHTML = '🛑 清空队列';
        stopButton.className = 'btn btn-secondary';
      } else {
        stopButton.innerHTML = '🛑 停止下载';
        stopButton.className = 'btn btn-secondary';
      }
      
      console.log('🔍 停止按钮状态:', {
        isDownloading: status.isDownloading,
        queueLength: status.queueLength,
        shouldEnableStopButton,
        disabled: stopButton.disabled,
        buttonText: stopButton.innerHTML
      });
    }
  } catch (error) {
    console.error('更新状态失败:', error);
  }
}

// 立即扫描
async function scanNow() {
  const button = document.getElementById('scanNow');
  button.disabled = true;
  button.textContent = '🔄 扫描中...';
  showLoading();
  
  try {
    // 查找抖音标签页
    const tabs = await chrome.tabs.query({ url: 'https://www.douyin.com/*' });
    
    if (tabs.length === 0) {
      alert('请先打开抖音网页！');
      return;
    }
    
    // 发送扫描消息到所有抖音标签页
    let successCount = 0;
    for (const tab of tabs) {
      // 先检查content script是否已就绪
      const ready = await isContentScriptReady(tab.id);
      if (ready) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'scanFollowing' });
          successCount++;
        } catch (error) {
          console.log('标签页', tab.id, '发送消息失败（已重试）:', error.message);
        }
      } else {
        console.log('标签页', tab.id, 'content script未就绪，跳过');
      }
    }
    
    // 如果没有任何标签页成功，提示用户
    if (successCount === 0) {
      alert('无法连接到抖音页面，请刷新页面后重试');
      button.disabled = false;
      button.textContent = '🔍 立即扫描关注列表';
      hideLoading();
      return;
    }
    
    // 等待一段时间后恢复按钮
    setTimeout(() => {
      button.disabled = false;
      button.textContent = '🔍 立即扫描关注列表';
      hideLoading();
      showNotification('扫描已开始', '正在获取关注列表和视频信息...');
    }, 3000);
    
  } catch (error) {
    console.error('扫描失败:', error);
    alert('扫描失败: ' + error.message);
    button.disabled = false;
    button.textContent = '🔍 立即扫描关注列表';
    hideLoading();
  }
}

// 停止下载
async function stopDownload() {
  try {
    console.log('🛑 用户点击停止下载按钮');
    const response = await chrome.runtime.sendMessage({ action: 'stopDownload' });
    
    if (response.success) {
      console.log('✅ 停止下载成功，响应:', response);
      const message = response.message || (
        response.clearedCount 
          ? `已停止下载并清空队列，移除了 ${response.clearedCount} 个待下载视频`
          : '已停止下载'
      );
      showNotification('停止下载', message);
      
      // 立即更新状态，确保UI反映最新情况
      await updateStatus();
      
      // 再次更新状态，确保所有状态都正确
      setTimeout(async () => {
        await updateStatus();
      }, 500);
    } else {
      console.error('❌ 停止下载失败:', response.error);
      alert('停止失败: ' + response.error);
    }
  } catch (error) {
    console.error('❌ 停止下载异常:', error);
    alert('停止失败: ' + error.message);
  }
}

// 切换自动下载
async function toggleAutoDownload() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'toggleAutoDownload' });
    
    if (response.success) {
      await updateStatus();
      const message = response.autoDownload ? '自动下载已启动' : '自动下载已暂停';
      showNotification('设置已更新', message);
    } else {
      alert('切换失败: ' + response.error);
    }
  } catch (error) {
    console.error('切换自动下载失败:', error);
    alert('切换失败: ' + error.message);
  }
}

// 打开管理页面
function openManage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('manage.html') });
}

// 打开抖音网页
function openDouyin() {
  chrome.tabs.create({ url: 'https://www.douyin.com' });
}

// 更改检查间隔
async function changeInterval() {
  const interval = parseInt(document.getElementById('checkInterval').value);
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'setCheckInterval',
      interval: interval
    });
    
    if (response.success) {
      showNotification('设置已更新', '检查间隔已修改');
    } else {
      alert('修改失败: ' + response.error);
    }
  } catch (error) {
    console.error('更改间隔失败:', error);
    alert('修改失败: ' + error.message);
  }
}

// 显示加载动画
function showLoading() {
  document.querySelector('.content').style.display = 'none';
  document.getElementById('loading').style.display = 'block';
}

// 隐藏加载动画
function hideLoading() {
  document.querySelector('.content').style.display = 'block';
  document.getElementById('loading').style.display = 'none';
}

// 显示通知
function showNotification(title, message) {
  if (chrome.notifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: title,
      message: message
    });
  }
}

// 监听来自background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadProgress') {
    updateStatus();
  }
});
