<script setup>
import { ref } from 'vue';
import { loginPassword, refreshCaptcha } from '../api.js';

const emit = defineEmits(['success', 'toPhone']);

const user = ref('');
const password = ref('');
const icode = ref('');
const sessionId = ref('');
const captchaImage = ref('');
const message = ref('');
const messageType = ref('ok');
const busy = ref(false);

function applyChallenge(result) {
  if (result.sessionId) sessionId.value = result.sessionId;
  if (result.captchaRequired && result.captchaImageBase64) {
    captchaImage.value = `data:image/png;base64,${result.captchaImageBase64}`;
    messageType.value = 'error';
    message.value = result.message || '请输入图形验证码';
    return true;
  }
  if (result.needsVerification) {
    messageType.value = 'error';
    message.value = result.message || '需要二次验证，请改用扫码登录';
    return true;
  }
  if (result.message) {
    messageType.value = 'error';
    message.value = result.message;
    return true;
  }
  return false;
}

async function onSubmit() {
  busy.value = true;
  message.value = '';
  try {
    const result = await loginPassword({
      user: user.value,
      password: password.value,
      sessionId: sessionId.value || undefined,
      icode: icode.value || undefined,
    });
    if (result.ok) {
      messageType.value = 'ok';
      message.value = '登录成功';
      emit('success');
      return;
    }
    applyChallenge(result);
  } catch (e) {
    messageType.value = 'error';
    message.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function onRefreshCaptcha() {
  try {
    const result = await refreshCaptcha(sessionId.value || undefined);
    applyChallenge(result);
  } catch (e) {
    messageType.value = 'error';
    message.value = e.message;
  }
}
</script>

<template>
  <form class="login-form" @submit.prevent="onSubmit">
    <input
      v-model="user"
      class="login-input"
      type="text"
      autocomplete="username"
      placeholder="邮箱 / 手机号码 / 小米 ID"
      required
    >
    <input
      v-model="password"
      class="login-input"
      type="password"
      autocomplete="current-password"
      placeholder="密码"
      required
    >
    <div v-if="captchaImage" class="login-captcha">
      <input v-model="icode" class="login-input" type="text" placeholder="图形验证码" required>
      <button type="button" class="login-captcha-btn" @click="onRefreshCaptcha">
        <img :src="captchaImage" alt="验证码">
      </button>
    </div>
    <button class="btn btn-primary login-submit" type="submit" :disabled="busy">登录</button>
    <div class="login-links">
      <button class="login-text-btn" type="button" @click="emit('toPhone')">手机短信登录</button>
      <a
        class="login-text-link"
        href="https://account.xiaomi.com/pass/forgetPassword"
        target="_blank"
        rel="noreferrer"
      >忘记密码？</a>
    </div>
    <div v-if="message" class="notice" :class="messageType">{{ message }}</div>
  </form>
</template>
