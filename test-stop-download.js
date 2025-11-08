// 测试停止下载功能的简单脚本
// 可以在浏览器控制台中运行

console.log('🧪 开始测试停止下载功能...');

// 测试1: 检查停止按钮是否可见
function testStopButtonVisibility() {
  const stopButton = document.getElementById('stopDownload');
  const stopButtonContainer = document.getElementById('stopButtonContainer');
  
  console.log('🔍 停止按钮测试结果:');
  console.log('- 停止按钮元素:', stopButton);
  console.log('- 停止按钮容器:', stopButtonContainer);
  console.log('- 容器显示状态:', stopButtonContainer?.style.display);
  console.log('- 按钮禁用状态:', stopButton?.disabled);
  console.log('- 按钮文本:', stopButton?.innerHTML);
}

// 测试2: 模拟停止下载
async function testStopDownload() {
  console.log('🛑 模拟点击停止下载按钮...');
  
  try {
    // 直接调用停止函数
    await stopDownload();
    console.log('✅ 停止下载函数调用成功');
  } catch (error) {
    console.error('❌ 停止下载函数调用失败:', error);
  }
}

// 测试3: 检查状态更新
async function testStatusUpdate() {
  console.log('🔄 测试状态更新...');
  
  try {
    await updateStatus();
    console.log('✅ 状态更新成功');
  } catch (error) {
    console.error('❌ 状态更新失败:', error);
  }
}

// 运行所有测试
async function runAllTests() {
  console.log('🚀 开始运行所有测试...');
  
  testStopButtonVisibility();
  await testStatusUpdate();
  // await testStopDownload(); // 取消注释来实际测试停止功能
  
  console.log('✅ 测试完成');
}

// 导出测试函数
window.testStopDownload = {
  testStopButtonVisibility,
  testStopDownload,
  testStatusUpdate,
  runAllTests
};

console.log('📝 测试函数已加载，使用 testStopDownload.runAllTests() 运行测试');