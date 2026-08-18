import { browser } from '#imports';
import { runCycle } from '../lib/cycle';
import { configItem } from '../lib/storage';

export default defineBackground(() => {
  const schedule = async () => {
    const { pollMinutes } = await configItem.getValue();
    await browser.alarms.create('poll', { periodInMinutes: Math.max(1, pollMinutes) });
  };

  browser.runtime.onInstalled.addListener(() => {
    void schedule();
    void runCycle();
  });
  browser.runtime.onStartup.addListener(() => {
    void schedule();
    void runCycle();
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'poll') void runCycle();
  });
  browser.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
    if (msg?.type !== 'refresh') return;
    void runCycle().then(sendResponse);
    return true;
  });
  configItem.watch(() => void schedule());
});
