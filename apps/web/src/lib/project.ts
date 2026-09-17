/**
 * 项目级常量：仓库地址、在线站点、版本号。
 *
 * 集中在一处，避免把 URL 散落在工具栏、关于弹窗、README 里各写一份。
 * 仓库地址取自 git 远端（`git@github.com:Crequency/TopoSmith.git` → https 形式）。
 */

/** 源码仓库（工具栏右上角的 GitHub 按钮与关于弹窗都指向它） */
export const REPO_URL = 'https://github.com/Crequency/TopoSmith';

/** 由 GitHub Pages 托管的在线站点 */
export const PAGES_URL = 'https://crequency.github.io/TopoSmith/';

/** 版本号由构建期注入（见 vite.config.ts 的 define），与 package.json 同步 */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export const LICENSE_NAME = 'MIT';
