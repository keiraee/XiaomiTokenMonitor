<script setup>
import { ref } from 'vue';
import { refreshCaptcha, sendPhoneCode, verifyPhone } from '../api.js';

const emit = defineEmits(['success', 'toPassword']);

const phone = ref('');
const ticket = ref('');
const icode = ref('');
const sessionId = ref('');
const captchaImage = ref('');
const sent = ref(false);
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
  if (result.message && !result.ok) {
    messageType.value = 'error';
    message.value = result.message;
    return true;
  }
  return false;
}

async function onSend() {
  busy.value = true;
  message.value = '';
  try {
    const result = await sendPhoneCode({
      phone: phone.value,
      sessionId: sessionId.value || undefined,
      icode: icode.value || undefined,
    });
    if (applyChallenge(result)) return;
    sent.value = true;
    captchaImage.value = '';
    icode.value = '';
    messageType.value = 'ok';
    message.value = result.message || '验证码已发送';
    if (result.sessionId) sessionId.value = result.sessionId;
  } catch (e) {
    messageType.value = 'error';
    message.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function onSubmit() {
  busy.value = true;
  message.value = '';
  try {
    const result = await verifyPhone({
      phone: phone.value,
      ticket: ticket.value,
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
    <div class="login-input-wrap">
      <span class="login-prefix">+86</span>
      <input
        v-model="phone"
        class="login-input login-input-plain"
        type="tel"
        inputmode="numeric"
        maxlength="11"
        placeholder="手机号码"
        required
      >
    </div>
    <div class="login-input-wrap">
      <input
        v-model="ticket"
        class="login-input login-input-plain"
        type="text"
        placeholder="短信验证码"
        :required="sent"
      >
      <button class="login-sms-btn" type="button" :disabled="busy || !phone" @click="onSend">
        {{ sent ? '重新发送' : '获取验证码' }}
      </button>
    </div>
    <div v-if="captchaImage" class="login-captcha">
      <input v-model="icode" class="login-input" type="text" placeholder="图形验证码" required>
      <button type="button" class="login-captcha-btn" @click="onRefreshCaptcha">
        <img :src="captchaImage" alt="验证码">
      </button>
    </div>
    <button class="btn btn-primary login-submit" type="submit" :disabled="busy || !sent">登录</button>
    <div class="login-links">
      <button class="login-text-btn" type="button" @click="emit('toPassword')">账号密码登录</button>
    </div>
    <div v-if="message" class="notice" :class="messageType">{{ message }}</div>
  </form>
</template>
