// entrypoints/newtab/main.ts
import { mount } from 'svelte';
import App from './App.svelte';
import '../../assets/tokens.css';
import { configItem, syncItem, modulesItem } from '../../lib/storage';

const [config, sync, modules] = await Promise.all([
  configItem.getValue(),
  syncItem.getValue(),
  modulesItem.getValue(),
]);

mount(App, { target: document.getElementById('app')!, props: { config, sync, modules } });
