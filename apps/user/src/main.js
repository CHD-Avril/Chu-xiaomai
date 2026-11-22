import { createApp } from "vue";
import { createPinia } from "pinia";
import "@fontsource-variable/manrope/wght.css";
import App from "./App.vue";
import router from "./router";
import "../../shared/theme.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app-shell.css";
import "./styles/components.css";

createApp(App).use(createPinia()).use(router).mount("#app");
