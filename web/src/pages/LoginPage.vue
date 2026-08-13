<script setup>
import { computed, ref } from 'vue';
import QrLoginPanel from '../components/QrLoginPanel.vue';
import PasswordLoginPanel from '../components/PasswordLoginPanel.vue';
import PhoneLoginPanel from '../components/PhoneLoginPanel.vue';

const emit = defineEmits(['success']);
const mode = ref('qr');
const lastForm = ref('password');

const titles = {
  qr: '扫码登录',
  password: '账号登录',
  phone: '手机号登录',
};

const title = computed(() => titles[mode.value]);
const earTip = computed(() => (mode.value === 'qr' ? '账号登录' : '扫码登录'));

function toggleQr() {
  if (mode.value === 'qr') {
    mode.value = lastForm.value;
    return;
  }
  lastForm.value = mode.value;
  mode.value = 'qr';
}

function toPassword() {
  lastForm.value = 'password';
  mode.value = 'password';
}

function toPhone() {
  lastForm.value = 'phone';
  mode.value = 'phone';
}
</script>

<template>
  <div class="login-shell">
    <div class="login-brand">
      <p class="eyebrow">Local Service</p>
      <h1>Token Monitor</h1>
      <p class="login-brand-sub">登录小米账号</p>
    </div>

    <section class="login-card">
      <header class="login-card-head">
        <h2>{{ title }}</h2>
        <button class="login-ear" type="button" :aria-label="earTip" @click="toggleQr">
          <span class="login-ear-tip">{{ earTip }}</span>
          <svg v-if="mode === 'qr'" class="login-ear-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="12" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="M8 20h8M12 16v4" fill="none" stroke="currentColor" stroke-width="1.8"/>
          </svg>
          <svg v-else class="login-ear-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
            <rect x="5" y="5" width="3" height="3" fill="#fff"/>
            <rect x="16" y="5" width="3" height="3" fill="#fff"/>
            <rect x="5" y="16" width="3" height="3" fill="#fff"/>
            <rect x="14" y="14" width="3" height="3"/>
            <rect x="18" y="14" width="3" height="3"/>
            <rect x="14" y="18" width="3" height="3"/>
            <rect x="18" y="18" width="3" height="3"/>
          </svg>
        </button>
      </header>

      <QrLoginPanel v-if="mode === 'qr'" @success="emit('success')" />
      <PasswordLoginPanel
        v-else-if="mode === 'password'"
        @success="emit('success')"
        @to-phone="toPhone"
      />
      <PhoneLoginPanel
        v-else
        @success="emit('success')"
        @to-password="toPassword"
      />
    </section>

    <footer class="login-foot">
      <span>127.0.0.1 · Local only</span>
    </footer>
  </div>
</template>
