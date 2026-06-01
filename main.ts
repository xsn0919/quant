// 1. 引入 puppeteer（Deno Deploy 支持的官方库）
import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";

// 2. 从环境变量读取密钥（安全实践）
const CRON_SECRET_KEY = Deno.env.get("CRON_SECRET_KEY") || "1234";
const TARGET_URL = "https://quant.ccccocccc.cc/cron_trigger.php";

// 3. 辅助：北京时间
function getBeijingTime(): { hour: number; minute: number; dayOfMonth: number; month: number; dayOfWeek: number; totalMinutes: number } {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const hour = beijingTime.getUTCHours();
  const minute = beijingTime.getUTCMinutes();
  const totalMinutes = hour * 60 + minute;
  const dayOfMonth = beijingTime.getUTCDate();
  const month = beijingTime.getUTCMonth() + 1;
  const dayOfWeek = beijingTime.getUTCDay() === 0 ? 7 : beijingTime.getUTCDay();
  return { hour, minute, dayOfMonth, month, dayOfWeek, totalMinutes };
}

// 4. 核心：执行任务（绕过 JS 挑战）
async function executeTask(taskName: string): Promise<void> {
  const url = `${TARGET_URL}?key=${CRON_SECRET_KEY}&task=${taskName}&force=1`;
  console.log(`[执行] ${taskName}`);

  let browser;
  try {
    browser = await puppeteer.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
    const body = await page.evaluate(() => document.body.innerText);
    const success = body.includes("OK") || body.includes("成功");
    console.log(`[结果] ${taskName} ${success ? "✅ 成功" : "❌ 失败"}`);
    await page.close();
  } catch (err) {
    console.error(`[错误] ${taskName} 执行异常:`, err.message);
  } finally {
    if (browser) await browser.close();
  }
}

// 5. Cron 调度主逻辑（每分钟检查一次）
Deno.cron("quant-scheduler", "* * * * *", async () => {
  const { hour, minute, dayOfMonth, month, dayOfWeek, totalMinutes } = getBeijingTime();

  const tasksToRun: string[] = [];

  // 静态任务（格式: '分钟 小时 日 月 周'）
  const staticTasks: Record<string, string> = {
    "31 1 * * *": "daily_sync",
    "36 1 * * *": "daily_sync_2",
    "41 1 * * *": "daily_sync_3",
    "46 1 * * *": "daily_sync_3",
    "51 1 * * *": "sync_etf_daily",
    "56 1 * * *": "daily_sync_list",
    "1 2 * * *": "factor_calc_1",
    "6 2 * * *": "factor_calc_2",
    "11 2 * * *": "factor_calc_3",
    "16 2 * * *": "factor_calc_4",
    "21 2 * * *": "factor_calc_5",
    "26 2 * * *": "factor_calc_6",
    "0 8 * * *": "morning_pick_1a",
    "5 8 * * *": "morning_pick_1b",
    "10 8 * * *": "morning_pick_2a",
    "15 8 * * *": "morning_pick_2b",
    "20 8 * * *": "morning_pick_3",
    "25 8 * * *": "morning_pick_1c",
    "20 9 * * *": "morning_analysis_trigger",
    "21 9 * * *": "morning_analysis_worker",
    "30 9 * * *": "enhance_pick_worker",
    "0 4 1 * *": "sync_names",
    "0 5 1 * *": "update_weights",
    "30 4 * * *": "historical_sync",
  };

  function matchCron(cronExpr: string): boolean {
    const parts = cronExpr.split(" ");
    if (parts.length !== 5) return false;
    const [cMin, cHour, cDay, cMon, cDow] = parts;
    if (cMin !== "*" && parseInt(cMin) !== minute) return false;
    if (cHour !== "*" && parseInt(cHour) !== hour) return false;
    if (cDay !== "*" && parseInt(cDay) !== dayOfMonth) return false;
    if (cMon !== "*" && parseInt(cMon) !== month) return false;
    if (cDow !== "*" && parseInt(cDow) !== dayOfWeek) return false;
    return true;
  }

  for (const [cron, task] of Object.entries(staticTasks)) {
    if (matchCron(cron)) tasksToRun.push(task);
  }

  // 动态任务：AI评分Worker（02:31-04:21 每10分钟）
  if (hour >= 2 && hour <= 4 && totalMinutes >= 151 && totalMinutes <= 261 && minute % 10 === 1) {
    tasksToRun.push("ai_score_worker");
  }

  // 盘中监控（周一至五 9:25-15:10 每15分钟）
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  if (isWeekday && totalMinutes >= 565 && totalMinutes <= 910 && minute % 15 === 0) {
    tasksToRun.push("intraday_30m");
  }

  // 实时监控（周一至五 9:28-15:05 每5分钟）
  if (isWeekday && totalMinutes >= 568 && totalMinutes <= 905 && minute % 5 === 0) {
    tasksToRun.push("realtime_monitor");
  }

  // NIM 保活
  const isTrading = isWeekday && totalMinutes >= 565 && totalMinutes <= 910;
  const isAIWorkerTime = hour >= 2 && hour <= 4 && totalMinutes >= 151 && totalMinutes <= 261;
  if (!isAIWorkerTime) {
    if ((hour === 4 && minute === 0) || (hour === 8 && minute === 0)) tasksToRun.push("nim_keep_alive");
    if (isTrading && minute % 5 === 0) tasksToRun.push("nim_keep_alive");
    if (!isTrading && minute % 30 === 0) tasksToRun.push("nim_keep_alive");
  }

  const uniqueTasks = [...new Set(tasksToRun)];
  if (uniqueTasks.length === 0) {
    console.log("当前分钟无任务");
    return;
  }

  console.log(`待执行任务: ${uniqueTasks.join(", ")}`);
  for (const task of uniqueTasks) {
    await executeTask(task);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
});

console.log("✅ 调度器已启动，每分钟检查一次任务");
