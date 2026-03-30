export const bmobConfig = {
  applicationId: "328e672f6062dcca76532237f04a4e5e",
  restApiKey: "a1c5b16a11736868d02618afabe92741",
  baseUrl: "https://open2.bmobapp.com/1",
  tables: {
    songs: "songs",
    likes: "songLikes",
  },
};

export function hasValidBmobConfig() {
  return (
    typeof bmobConfig.applicationId === "string" &&
    bmobConfig.applicationId.trim() !== "" &&
    typeof bmobConfig.restApiKey === "string" &&
    bmobConfig.restApiKey.trim() !== "" &&
    typeof bmobConfig.baseUrl === "string" &&
    bmobConfig.baseUrl.trim() !== ""
  );
}
