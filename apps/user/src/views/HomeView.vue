<script setup>
import { ref } from "vue";
import HeroSection from "../components/HeroSection.vue";
import StatsRow from "../components/StatsRow.vue";
import NoticeBoard from "../components/NoticeBoard.vue";
import SubmissionForm from "../components/SubmissionForm.vue";

const submitSection = ref(null);

function scrollToSubmit() {
  submitSection.value?.$el.scrollIntoView({ behavior: "smooth", block: "center" });
}
</script>

<template>
  <div>
    <HeroSection @go-submit="scrollToSubmit" />
    <StatsRow />
    <div class="content-grid">
      <NoticeBoard />
      <SubmissionForm ref="submitSection" />
    </div>
  </div>
</template>
