<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    src: string;
    frameWidth: number;
    frameHeight: number;
    totalFrames: number;
    startFrame?: number;
    frameCount?: number;
    fps?: number;
    scale?: number;
    alt?: string;
    paused?: boolean;
  }>(),
  {
    startFrame: 0,
    frameCount: undefined,
    fps: 4,
    scale: 1,
    alt: "",
    paused: false,
  }
);

const count = computed(() => props.frameCount ?? props.totalFrames - props.startFrame);
const style = computed(() => {
  const w = props.frameWidth * props.scale;
  const h = props.frameHeight * props.scale;
  const bgW = props.frameWidth * props.totalFrames * props.scale;
  const startX = props.startFrame * props.frameWidth * props.scale;
  const endX = startX + count.value * props.frameWidth * props.scale;
  const duration = count.value / props.fps;
  return {
    width: `${w}px`,
    height: `${h}px`,
    backgroundImage: `url(${props.src})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${bgW}px ${h}px`,
    "--sprite-start-x": `-${startX}px`,
    "--sprite-end-x": `-${endX}px`,
    "--sprite-duration": `${duration}s`,
    "--sprite-steps": `${count.value}`,
    animationPlayState: props.paused ? "paused" : "running",
  } as Record<string, string>;
});
</script>

<template>
  <span
    class="sprite-sheet"
    role="img"
    :aria-label="alt"
    :style="style"
  ></span>
</template>

<style scoped>
.sprite-sheet {
  display: inline-block;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  background-position: var(--sprite-start-x) 0;
  animation: sprite-play var(--sprite-duration) steps(var(--sprite-steps)) infinite;
}

@keyframes sprite-play {
  from {
    background-position: var(--sprite-start-x) 0;
  }
  to {
    background-position: var(--sprite-end-x) 0;
  }
}
</style>
