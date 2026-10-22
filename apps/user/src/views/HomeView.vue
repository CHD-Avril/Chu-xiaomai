<script setup>
import HeroSection from "../components/HeroSection.vue";
import NoticeBoard from "../components/NoticeBoard.vue";
import SubmissionForm from "../components/SubmissionForm.vue";
import SongPreview from "../components/SongPreview.vue";
import ParticipationGuide from "../components/ParticipationGuide.vue";
</script>

<template>
  <div class="home-page">
    <div class="home-stage">
      <div class="home-intro"><HeroSection /></div>
      <SubmissionForm />
    </div>
    <div class="community-grid"><SongPreview /><NoticeBoard /></div>
    <ParticipationGuide />
  </div>
</template>
