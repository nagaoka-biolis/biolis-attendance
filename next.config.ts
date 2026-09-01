import type { NextConfig } from "next";

// ビルドごとに変わる識別子。画面側とサーバ側の両方に同じ値が入る。
// 開きっぱなしの古い画面を検知して「更新」を促すために使う
// （ブラウザのキャッシュ設定は正しく効いているが、開いたままのページは
//   自分から新しくならないため）。
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? String(Date.now());

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
};

export default nextConfig;
