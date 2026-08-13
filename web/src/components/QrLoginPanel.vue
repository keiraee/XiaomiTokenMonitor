<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { cancelQr, qrStatus, startQr } from '../api.js';

const emit = defineEmits(['success']);

const sessionId = ref('');
const image = ref('');
const tips = ref('请使用小米手机 / 平板扫码登录');
const statusText = ref('');
const message = ref('');
const messageType = ref('ok');
const loading = ref(false);
const expired = ref(false);
let pollTimer = null;

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function start() {
  stopPolling();
  loading.value = true;
  expired.value = false;
  message.value = '';
  statusText.value = '正在获取二维码';

  try {
    if (sessionId.value) {
      cancelQr(sessionId.value).catch(() => {});
    }
    const data = await startQr();
    sessionId.value = data.sessionId;
    image.value = `data:image/png;base64,${data.qrImageBase64}`;
    tips.value = data.qrTips || '请使用小米手机 / 平板扫码登录';
    statusText.value = '';

    pollTimer = setInterval(async () => {
      try {
        const status = await qrStatus(sessionId.value);
        if (status.status === 'pending') {
          statusText.value = status.expiresIn <= 30 ? `即将过期 ${status.expiresIn}s` : '';
          return;
        }
        stopPolling();
        if (status.status === 'success') {
          messageType.value = 'ok';
          message.value = '登录成功';
          statusText.value = '';
          emit('success');
          return;
        }
        expired.value = status.status === 'expired';
        messageType.value = 'error';
        message.value = expired.value ? '' : (status.error || '登录失败');
        statusText.value = expired.value ? '' : '登录失败';
      } catch (e) {
        stopPolling();
        messageType.value = 'error';
        message.value = e.message;
        statusText.value = '';
      }
    }, 2000);
  } catch (e) {
    messageType.value = 'error';
    message.value = e.message;
    statusText.value = '';
    expired.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(start);
onUnmounted(() => {
  stopPolling();
  if (sessionId.value) cancelQr(sessionId.value).catch(() => {});
});
</script>

<template>
  <div class="login-qr">
    <button class="login-qr-frame" type="button" :disabled="loading" @click="start">
      <img
        v-if="image"
        class="login-qr-image"
        :class="{ dim: expired || loading }"
        :src="image"
        alt="登录二维码"
      >
      <div v-if="!image || expired || loading" class="login-qr-mask">
        <span v-if="loading">正在获取二维码</span>
        <template v-else>
          <span>{{ expired && image ? '二维码已失效' : '点击获取二维码' }}</span>
          <span class="login-qr-refresh">点击刷新</span>
        </template>
      </div>
    </button>
    <p class="login-qr-tips">{{ tips }}</p>
    <p v-if="statusText" class="login-qr-status">{{ statusText }}</p>
    <div v-if="message" class="notice" :class="messageType">{{ message }}</div>
  </div>
</template>
