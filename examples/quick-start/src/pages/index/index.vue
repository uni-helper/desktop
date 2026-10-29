<script setup lang="ts">
import { onMounted, ref } from 'vue'

const message = ref('Try the desktop APIs below.')
const clipboardText = ref('')
const imagePath = ref('')
const savedFilePath = ref('')
const platform = ref('')

async function copyToClipboard() {
  await uni.setClipboardData({ data: 'Hello from uni-app desktop!' })
  message.value = 'Copied to clipboard.'
}

async function readClipboard() {
  const res = await uni.getClipboardData()
  clipboardText.value = res.data
}

async function pickImage() {
  const res = await uni.chooseImage({ count: 1 })
  imagePath.value = res.tempFilePaths[0] ?? ''
  message.value = 'Image picked through the native dialog.'
}

async function saveImage() {
  if (!imagePath.value) {
    message.value = 'Pick an image first.'
    return
  }
  const res = await uni.saveFile({ tempFilePath: imagePath.value })
  savedFilePath.value = res.savedFilePath
  message.value = 'Saved into the app-managed directory.'
}

async function openSaved() {
  if (!savedFilePath.value) {
    message.value = 'Save an image first.'
    return
  }
  await uni.openDocument({ filePath: savedFilePath.value })
}

onMounted(() => {
  uni.getSystemInfo({
    success: (res) => {
      platform.value = `${res.osName} ${res.osVersion}`
    },
  })
})
</script>

<template>
  <view class="page">
    <text class="title">
      uni-app + Electron
    </text>
    <text class="message">
      {{ message }}
    </text>
    <text class="meta">
      Platform: {{ platform || '…' }}
    </text>

    <button class="action" @click="copyToClipboard">
      Copy to clipboard
    </button>
    <button class="action" @click="readClipboard">
      Read clipboard
    </button>
    <text v-if="clipboardText" class="meta">
      Clipboard: {{ clipboardText }}
    </text>

    <button class="action" @click="pickImage">
      Choose an image
    </button>
    <image
      v-if="imagePath"
      :src="imagePath"
      class="preview"
      mode="aspectFit"
    />
    <button class="action" :disabled="!imagePath" @click="saveImage">
      Save the picked image
    </button>
    <button class="action" :disabled="!savedFilePath" @click="openSaved">
      Open the saved file
    </button>
    <text v-if="savedFilePath" class="meta small">
      {{ savedFilePath }}
    </text>
  </view>
</template>

<style>
.page {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding: 32rpx;
}

.title {
  font-size: 40rpx;
  font-weight: 600;
}

.message {
  color: #4b5563;
}

.meta {
  color: #6b7280;
  font-size: 24rpx;
}

.meta.small {
  word-break: break-all;
}

.action {
  margin-top: 8rpx;
}

.preview {
  height: 320rpx;
  width: 100%;
}
</style>
