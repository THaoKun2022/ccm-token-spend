# ccm-token-spend 鈥斺€?Codex 妗岄潰鐗?Token 娑堣€楃粺璁￠潰鏉?
鍦?Codex / ChatGPT **妗岄潰鐗?*鐣岄潰鍙充笅瑙掓樉绀恒€屾瘡涓璇?/ 姣忚疆瀵硅瘽銆嶇殑 token 娑堣€楅噺锛氭湰杞秷鑰椼€佷細璇濈疮璁°€佽姹傛鏁般€佷笂涓嬫枃绐楀彛銆佽緭鍏ョ紦瀛樺懡涓媶鍒嗐€佹渶杩戣疆娆″垪琛紝鏁版嵁绾?**1 绉?*瀹炴椂鍒锋柊銆?
## 鈿狅笍 浣跨敤鍓嶆彁锛堣鍏堟寜椤哄簭纭锛?
1. **浠呮敮鎸?Codex / ChatGPT 妗岄潰鐗堬紝涓嶆敮鎸?codex CLI銆?*
2. **蹇呴』瀹夎 Codex++**锛堣礋璐ｆ妸闈㈡澘鑴氭湰娉ㄥ叆椤甸潰锛屽苟閫氳繃璋冭瘯绔彛 9229 鎺ㄩ€佹暟鎹級銆傛病瑁?Codex++ 鐨勮瘽锛屾湰宸ュ叿涓嶉€傜敤銆?3. **鐩戞帶绋嬪簭浜岄€変竴锛?*
   - 鐢佃剳涓?*宸插畨瑁?Node.js锛堚墺 18锛?* 鈫?浣跨敤 `node-version`锛堣剼鏈柟寮忥紝浣撶Н灏忥級锛?   - 鐢佃剳涓?*娌℃湁 Node.js** 鈫?浣跨敤 `exe-version`锛堝厤瀹夎銆佸厤鐜锛屼綋绉害 55MB锛夈€?
```
鍒ゆ柇娴佺▼锛?Codex 妗岄潰鐗堬紵 鈹€鈹€鍚︹攢鈹€> 涓嶆敮鎸侊紙CLI 鐢ㄦ埛璇峰嬁缁х画锛?   鈹傛槸
宸茶 Codex++锛?鈹€鈹€鍚︹攢鈹€> 鍏堝畨瑁?Codex++锛屽惁鍒欎笉鏀寔
   鈹傛槸
宸茶 Node.js锛?鈹€鈹€鏄攢鈹€> 鐢?node-version
   鈹傚惁
鐢?exe-version
```

## 瀹夎锛堜袱涓増鏈€氱敤锛屽彧闇€鍋氫竴娆★級

1. 鎶?`codex-token-spend-panel.js` 澶嶅埗鍒?Codex++ 鐨勭敤鎴疯剼鏈洰褰曪細

   ```powershell
   Copy-Item .\codex-token-spend-panel.js "$env:APPDATA\Codex++\user_scripts\" -Force
   ```

2. **瀹屽叏閫€鍑哄苟閲嶅惎 Codex 妗岄潰鐗?*锛岃鑴氭湰娉ㄥ叆椤甸潰锛堝彸涓嬭搴斿嚭鐜伴潰鏉匡級銆?
## 杩愯鐩戞帶锛堟瘡娆℃兂鐢ㄦ椂鎵ц锛?
- **Node 鐗堬細**
  ```powershell
  cd node-version
  node token-stats.mjs --watch --cdp
  ```
- **exe 鐗堬細**
  ```powershell
  cd exe-version
  ccm-token-spend.exe --watch --cdp
  ```
- 涔熷彲浠ョ洿鎺?*鍙屽嚮**瀵瑰簲鏂囦欢澶归噷鐨?`start-watch.cmd`銆?
淇濇寔杩欎釜绐楀彛杩愯鍗冲彲銆傞潰鏉垮彸涓婅 `脳` 鍙敹璧蜂负灏忔寜閽紝鐐瑰皬鎸夐挳鎭㈠锛涙爣棰樻爮鍙嫋鍔紝鍙充笅瑙掑彲鎷栨嫿璋冩暣澶у皬銆?
## 鏁版嵁璇存槑

- 鍙鍙?Codex 鑷繁鐨勬湰鍦颁細璇濇棩蹇楋紙`%USERPROFILE%\.codex\sessions\...\rollout-*.jsonl`锛夛紝**涓嶆秹鍙婁换浣曞瘑閽?*锛岄潰鏉垮彧鏄剧ず鏁板瓧鎽樿銆?- 銆屼細璇濈疮璁°€? 璇ュ璇濇墍鏈夎姹傜殑 billed token 涔嬪拰锛堝惈姣忚疆閲嶅鍙戦€佺殑涓婁笅鏂囷級銆?- 銆屾瘡杞€? 涓€娆＄敤鎴锋秷鎭埌涓嬩竴娆＄敤鎴锋秷鎭箣闂村彂鐢熺殑鎵€鏈夎姹傘€?- 杈撳叆缂撳瓨鎷嗗垎锛歚杈撳叆 X锛堢紦瀛樺懡涓?Y锛屾湭鍛戒腑 Z锛塦锛屽叾涓湭鍛戒腑 = 杈撳叆 鈭?缂撳瓨鍛戒腑锛涙棫鏃ュ織娌℃湁缂撳瓨瀛楁鏃惰嚜鍔ㄦ樉绀轰负 `杈撳叆 X + 杈撳嚭 W`銆?- 鏂板璇濓紙灏氭棤鏁版嵁锛夋樉绀?0锛岃€屼笉鏄€屾殏鏃犳暟鎹€嶃€?
## 鑷磋阿

闈㈡澘鐨勩€屽綋鍓嶅璇?ID銆嶆潵鑷紑婧愰」鐩?[codex-context-used-meter](https://github.com/Minghou-Lei/codex-context-used-meter)锛圡IT License锛夋敞鍏ョ殑 `__codexContextMeter`銆傛湭瀹夎璇ヨ剼鏈椂鑷姩闄嶇骇涓烘寜鏈€鏂颁細璇濇枃浠跺垽鏂€

## 开发者：命令行直接查看（无需面板）

```powershell
node token-stats.mjs                  # 最近一个对话
node token-stats.mjs --thread <id>    # 指定对话
node token-stats.mjs --detail         # 附带每次请求明细
node token-stats.mjs --all            # 所有对话的累计消耗
```