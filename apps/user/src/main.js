import { createApp } from "vue";
import { createPinia } from "pinia";
import "@fontsource-variable/inter/wght.css";
import App from "./App.vue";
import router from "./router";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app-shell.css";
import "./styles/components.css";

document.documentElement.classList.add("app-boot");
setTimeout(() => document.documentElement.classList.remove("app-boot"), 900);

createApp(App).use(createPinia()).use(router).mount("#app");