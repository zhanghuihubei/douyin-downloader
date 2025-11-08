# 🚨 数据恢复指南

## ❌ 问题说明

**严重BUG**: 在 v2.0 版本中，每次"立即扫描关注列表"时，会错误地将所有视频标记为 `downloaded: false`，**导致已下载的视频记录丢失**。

### 问题表现
```
症状1: 所有用户显示 0 视频
症状2: 已下载视频变成 5 个（实际可能有 685 个）
症状3: 重新扫描后，已下载的视频又被重复下载
症状4: 文件重复下载，命名为 xxx(1).mp4, xxx(2).mp4
```

### 根本原因
```javascript
// ❌ 错误代码 (background.js 第289行)
await DouyinDB.saveVideos(videos.map(v => ({
  ...v,
  downloaded: false  // 这会覆盖已下载的视频状态！
})));
```

每次扫描时，所有视频（包括已下载的）都被重新保存为"未下载"状态。

---

## ✅ 修复方案

### 已修复内容

**1. db.js - saveVideo 函数**
```javascript
// ✅ 新增 preserveDownloadStatus 参数
async function saveVideo(video, preserveDownloadStatus = false) {
  // 如果视频已存在且已下载，保留原状态
  if (preserveDownloadStatus && existingVideo && existingVideo.downloaded) {
    videoData.downloaded = true;
    videoData.downloadTime = existingVideo.downloadTime;
    videoData.filename = existingVideo.filename;
  }
}
```

**2. db.js - saveVideos 函数**
```javascript
// ✅ 支持批量保护
async function saveVideos(videos, preserveDownloadStatus = false) {
  const promises = videos.map(video => saveVideo(video, preserveDownloadStatus));
  return await Promise.all(promises);
}
```

**3. background.js - addToQueue 函数**
```javascript
// ✅ 扫描时保护已下载状态
await DouyinDB.saveVideos(videos.map(v => ({
  ...v,
  downloaded: false  // 新视频标记为未下载
})), true);  // ✅ preserveDownloadStatus = true
```

---

## 🔧 数据恢复步骤

### 方案1: 从文件系统恢复（推荐）

如果你的视频文件还在"下载/抖音视频"文件夹中：

1. **不要删除任何文件！**
2. **重新加载扩展**（修复已生效）
3. **清理数据库**
   ```
   - 打开管理页面
   - 点击"🧹 清理迁移数据"（清理旧数据）
   - 点击"🗑️ 删除全部记录"（清空数据库）
   ```
4. **重新扫描**
   ```
   - 打开抖音页面
   - 点击"立即扫描关注列表"
   - 等待扫描完成
   - 让扩展重新检测文件并建立记录
   ```

**注意**: 这个方案会让扩展重新下载视频，但由于Chrome下载管理器会检测重复文件，所以不会真正重复下载，只是会建立新的下载记录。

### 方案2: 手动清理重复文件

如果已经产生了重复文件（xxx(1).mp4）：

1. **重新加载扩展**（应用修复）
2. **手动检查"下载/抖音视频"文件夹**
3. **删除重复文件**
   ```
   保留: video.mp4 (原始文件)
   删除: video(1).mp4, video(2).mp4 (重复文件)
   ```
4. **清理数据库并重新扫描**（参考方案1）

### 方案3: 从 chrome.storage.local 恢复（如果有）

如果旧数据还在 `chrome.storage.local` 中：

1. **打开 Chrome DevTools**
   ```
   F12 → Application → Storage → IndexedDB → chrome-extension://xxx
   ```
2. **检查 downloadedVideos**
   - 查看是否有旧的视频ID列表
3. **手动导入**（需要技术能力）
   ```javascript
   // 在 background.js console 中执行
   chrome.storage.local.get(['downloadedVideos'], async (data) => {
     if (data.downloadedVideos) {
       console.log('发现', data.downloadedVideos.length, '个旧记录');
       // 标记为已下载
       for (const awemeId of data.downloadedVideos) {
         await DouyinDB.markVideoAsDownloaded(awemeId, {
           filename: 'recovered.mp4',
           downloadTime: Date.now()
         });
       }
     }
   });
   ```

---

## 🛡️ 预防措施

### 现在已修复
- ✅ 扫描时保护已下载状态
- ✅ 不会覆盖现有下载记录
- ✅ 安全更新视频元数据

### 测试验证
```
1. 下载一个视频
2. 记录视频ID和状态
3. 立即扫描关注列表
4. 检查视频状态是否保持 downloaded: true
5. 检查是否重复下载
```

---

## 📊 检查数据完整性

### 方法1: 管理页面
```
1. 打开管理页面
2. 查看"已下载"数量
3. 切换到"所有视频"标签
4. 检查视频列表是否完整
```

### 方法2: 开发者工具
```
1. F12 → Application → IndexedDB
2. 打开 DouyinDownloaderDB → videos
3. 查看所有记录
4. 筛选 downloaded = true 的记录
5. 对比文件系统中的实际文件
```

### 方法3: Console 脚本
```javascript
// 在管理页面的 console 中执行
chrome.runtime.sendMessage({ action: 'getStats' }, (stats) => {
  console.log('📊 数据库统计:', stats);
  console.log('视频总数:', stats.totalVideos);
  console.log('已下载:', stats.downloadedVideos);
  console.log('待下载:', stats.pendingVideos);
});

chrome.runtime.sendMessage({ action: 'getAllDownloadedVideos' }, (videos) => {
  console.log('📹 已下载视频列表:', videos);
  console.log('详细信息:');
  videos.forEach((v, i) => {
    console.log(`${i+1}. ${v.title} - ${v.author} (${v.awemeId})`);
  });
});
```

---

## ⚠️ 已知限制

### 无法恢复的数据
- ❌ 下载时间（会重置为恢复时间）
- ❌ 原始文件名（如果已重命名）
- ❌ 添加时间（会重置为恢复时间）

### 可以恢复的数据
- ✅ 视频ID
- ✅ 作者信息
- ✅ 视频标题
- ✅ 视频元数据（时长、发布时间等）
- ✅ 下载状态

---

## 📝 操作记录

建议记录你的恢复过程：

```
[ ] 1. 备份"下载/抖音视频"文件夹
[ ] 2. 重新加载扩展（应用修复）
[ ] 3. 打开管理页面，记录当前状态
    - 用户数: ___
    - 视频总数: ___
    - 已下载: ___
[ ] 4. 清理迁移数据
[ ] 5. 删除全部记录（如果需要）
[ ] 6. 重新扫描关注列表
[ ] 7. 检查恢复结果
    - 用户数: ___
    - 视频总数: ___
    - 已下载: ___
[ ] 8. 清理重复文件
```

---

## 🆘 需要帮助？

如果恢复过程中遇到问题：

1. **检查 Console 日志**
   - 打开扩展管理页面
   - 点击"背景页"或"Service Worker"
   - 查看错误信息

2. **导出数据库**
   ```
   F12 → Application → IndexedDB → DouyinDownloaderDB
   右键 → Export
   保存为 backup.json
   ```

3. **重置扩展**（最后手段）
   ```
   chrome://extensions/
   找到"抖音下载器"
   点击"移除"
   重新安装
   ```

---

## 🎯 预防未来问题

### 定期备份
```
1. 每周导出 IndexedDB 数据
2. 备份"下载/抖音视频"文件夹
3. 记录重要视频的 awemeId
```

### 监控数据
```
1. 定期检查管理页面统计
2. 对比文件数量和记录数量
3. 发现异常立即停止操作
```

### 更新谨慎
```
1. 更新前备份数据
2. 在测试环境验证
3. 记录当前状态
```

---

## 版本说明

- **v2.0 (有BUG)**: 扫描会覆盖已下载状态
- **v2.1 (已修复)**: 扫描时保护已下载状态

确保你使用的是 **v2.1 或更高版本**！
