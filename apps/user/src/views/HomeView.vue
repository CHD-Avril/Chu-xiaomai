<script setup>
import HeroSection from "../components/HeroSection.vue";
import NoticeBoard from "../components/NoticeBoard.vue";
import SubmissionForm from "../components/SubmissionForm.vue";
import SongPreview from "../components/SongPreview.vue";
import ParticipationGuide from "../components/ParticipationGuide.vue";
</script>

<template>
  <div class="home-page">
    <HeroSection />
    <div class="home-stage">
      <SubmissionForm />
      <aside class="home-side">
        <SongPreview />
        <NoticeBoard />
      </aside>
    </div>
    <ParticipationGuide />
  </div>
</template>