<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import AuthPanel from '../components/AuthPanel.vue';
import UsagePanel from '../components/UsagePanel.vue';
import UsageTable from '../components/UsageTable.vue';
import { getUsage } from '../api.js';

const props = defineProps({
  auth: { type: Object, default: () => ({}) },
  cachedUsage: { type: Object, default: null },
});
const emit = defineEmits(['logged-out', 'status']);

const usage = ref(null);
const usageError = ref('');
let timer = null;

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN');
}

async function loadUsage() {
  usageError.value = '';
  try {
    usage.value = await getUsage();
    emit('status');
  } catch (e) {
    usageError.value = e.message;
    emit('status');
  }
}

onMounted(() => {
  loadUsage();
  timer = setInterval(() => emit('status'), 30000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="page">
    <header class="hero">
      <h1>Token Monitor</h1>
      <p class="subtitle">已登录 · 自动续约 · 用量查询</p>
    </header>

    <div class="dashboard-grid">
      <AuthPanel
        :auth="auth"
        :format-time="formatTime"
        @refreshed="emit('status')"
        @logged-out="emit('logged-out')"
      />
      <UsagePanel
        :usage="usage"
        :fallback="cachedUsage"
        :error="usageError"
        :format-time="formatTime"
        @refresh="loadUsage"
      />
    </div>

    <UsageTable :items="usage?.items || []" />
  </div>
</template>
