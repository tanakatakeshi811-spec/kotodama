# マップ制作（コトダマ）の開発用ファイル

アプリ本体は **リポジトリ直下の `index.html` が正**（1ファイルで完結・ビルド不要）。
このフォルダは、マップ制作を作ったときの「分割ソース」と「自動テスト」の控えです。`index.html` を直接直してもかまいません（その場合、ここは古くなります）。

## 中身

| 場所 | 役割 |
| --- | --- |
| `src/01_core.js` 〜 `99_end.js` | マップ制作のモジュール。番号順につなぐと `const MapMaker = (() => { … })();` になる |
| `src/mm.css` | マップ制作の見た目（`/* mm:start */` 〜 `/* mm:end */` として `</style>` の前に入る） |
| `src/patches.py` | コトダマ本体へのつなぎ込み。「本体のここ1か所だけに一致する文字列 → 差し替え後」の一覧 |
| `build.py` | マップ制作を入れる前の `index.html` に、上の3つを組み込んで1つのHTMLにする |
| `tests/` | ヘッドレスChromium（Playwright）の自動テスト。外のネットワークは `tests/mocks.js` の偽物 |
| `lint.py` | 公開用 `index.html` の構文と未定義変数のチェック |

モジュールの中身：`01_core`=保存(Store)・共通 / `02_osm`=OpenStreetMap(Nominatim・Overpass)と気温(Open-Meteo) / `03_layout`=建物内の見取り図の目安 / `04_assemble`=地図データの組み立て / `05_sample`=見本 / `06_render`=Canvas2Dの斜め投影3D / `07_view`=カメラ・操作 / `08_gen`=AIで下調べ＋お店リストを作る流れ / `09_lib`=ライブラリ・作成ダイアログ / `10_view`=ビューア画面（2D/3D・検索・カード・気温・GPS） / `11_act`=ボタンの動作・AIチャット・LIVE連携。

## 組み立て直す

```sh
git show a80c267:index.html > base_index.html      # マップ制作を入れる前の版
python3 build.py base_index.html out/index.html    # 公開中の index.html と同じものができる
```

## テスト

```sh
pip install playwright && playwright install chromium
cd tests
python3 t_gen2.py                 # 例: 生成の失敗・中断・途中までで完成
KD_HTML=../out/index.html python3 t_create.py   # 別の版を開くとき（既定はリポジトリ直下の index.html）
```

| テスト | 見ているもの |
| --- | --- |
| `t_smoke` `t_view` `t_guide` | 起動・ライブラリ・ビューアが開く／はじめのガイドの表にマップ制作がある |
| `t_create` | 作成の流れ（モール／遊園地／店／AIなし）・候補選び・気温 |
| `t_view2` | 2D↔3D・階の切替・検索・カテゴリ・カード・GPS・道すじ |
| `t_edit` | スポットの追加・編集・削除、書き出し／読み込み、マップの削除・作り直し |
| `t_ai` | マップを見ながらのAIチャット（タグ・画面の画像・再生成・停止・保存） |
| `t_mobile` `t_dark` | スマホ幅（ボトムシート）・ダークモード |
| `t_live` | LIVEとの連携（マップを見ながらLIVE・画面の画像をAIに渡す） |
| `t_stress` | 500件でも軽い・クラウド保存形式（分割保存） |
| `t_gen` `t_gen2` | 生成の流れ・失敗時（見つからない／検索失敗／Overpass停止／下調べ失敗／途中で切れたリスト／中断／途中までで完成） |

- 先に `window.__KD_TEST = true` を入れると、本体の部品が `window.__kd` で見える（`harness.py`）。
- 偽物の差し込み口は `MapMaker.test.{fetch, ai, wx, geo, noWx}`、内部は `MapMaker._t`。
- 偽のAI（`mocks.js`）は、実コードが送る文言（「本館 1階」など）に合わせて反応する。文言を変えたらモックも合わせること（合っていないと、テストが「何も見つからない」ように見えて誤って失敗する）。
- 本物の Nominatim / Overpass / Open-Meteo / 中継AI / 実機のGPS・スマホは、このテストでは確認できない。
