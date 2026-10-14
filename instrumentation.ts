export async function register(): Promise<void> {
  // 须用 === 'nodejs' 包裹而非提前 return：Edge 编译时才能整段剔除，否则静态分析会报 Node API 警告
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerShutdownSignals } = await import('@/server/lifecycle/shutdown');
    registerShutdownSignals();
  }
}
