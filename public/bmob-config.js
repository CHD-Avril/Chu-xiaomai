export const bmobConfig = {
  applicationId: "328e672f6062dcca76532237f04a4e5e",
  restApiKey: "04a2b60a36ef6045729937e1539f4c04",
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
