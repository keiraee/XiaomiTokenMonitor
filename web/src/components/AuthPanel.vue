<script setup>
import { computed, ref } from 'vue';
import { logout, refreshAuth } from '../api.js';

const props = defineProps({
  auth: { type: Object, default: () => ({}) },
  formatTime: { type: Function, required: true },
});
const emit = defineEmits(['refreshed', 'loggedOut']);

const message = ref('');
const messageType = ref('ok');

const labels = {
  authenticated: ['已登录，自动续约中', 'ok'],
  needs_refresh: ['已登录，等待刷新 Token', 'warn'],
  relogin_required: ['需要重新登录', 'bad'],
  refresh_failed: ['自动刷新失败', 'bad'],
  unauthenticated: ['未登录', 'bad'],
};

const badge = computed(() => labels[props.auth.state] || ['状态未知', 'warn']);

async function onRefresh() {
  message.value = '';
  try {
    await refreshAuth();
    messageType.value = 'ok';
    message.value = 'Token 刷新成功';
    emit('refreshed');
  } catch (e) {
    messageType.value = 'error';
    message.value = e.message;
    emit('refreshed');
  }
}

async function onLogout() {
  if (!confirm('确定退出登录并清除 Cookie？')) return;
  message.value = '';
  await logout();
  messageType.value = 'ok';
  message.value = '已退出登录';
  emit('loggedOut');
}
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <p class="eyebrow">认证</p>
      <h2>认证状态</h2>
    </div>
    <div class="status-line" :class="badge[1]">
      <span class="status-dot" aria-hidden="true"></span>
      <span class="status-text">{{ badge[0] }}</span>
    </div>
    <dl class="spec-list">
      <dt>Pass Token</dt>
      <dd>{{ auth.passTokenExpiresText || '—' }}</dd>
      <dt>Service Token</dt>
      <dd>{{ auth.serviceTokenExpiresText || '—' }}</dd>
      <dt>上次刷新</dt>
      <dd>{{ formatTime(auth.lastRefresh) }}</dd>
      <dt>下次刷新</dt>
      <dd>{{ formatTime(auth.nextRefresh) }}</dd>
      <dt>代理接口</dt>
      <dd><code>{{ auth.usageUrl || '—' }}</code></dd>
    </dl>
    <div class="actions">
      <button class="btn btn-outline" type="button" @click="onRefresh">刷新 Token</button>
      <button class="btn btn-ghost" type="button" @click="onLogout">退出登录</button>
    </div>
    <div v-if="message" class="notice" :class="messageType">{{ message }}</div>
  </section>
</template>
