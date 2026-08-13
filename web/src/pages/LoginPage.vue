<script setup>
import QrLoginPanel from '../components/QrLoginPanel.vue';

const emit = defineEmits(['success']);
</script>

<template>
  <div class="login-shell">
    <div class="login-brand">
      <h1>Token Monitor</h1>
      <p class="login-brand-sub">扫码登录小米账号</p>
    </div>

    <section class="login-card">
      <header class="login-card-head">
        <h2>扫码登录</h2>
      </header>
      <QrLoginPanel @success="emit('success')" />
    </section>
  </div>
</template>
