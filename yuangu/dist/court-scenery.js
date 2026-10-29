// 上庭整幅场景的矢量占位。装饰与透明热区分离，不承载剧情或状态规则。
export function createCourtScenery(){
  const el=document.createElement('div');el.className='court-scenery';el.setAttribute('aria-hidden','true');
  el.innerHTML=`<svg viewBox="0 0 1000 300" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="court-air" x2="0" y2="1"><stop stop-color="#e6eeeb"/><stop offset="1" stop-color="#e9e4d2"/></linearGradient>
      <linearGradient id="court-cloud" x2="0" y2="1"><stop stop-color="#fffdf1" stop-opacity=".8"/><stop offset="1" stop-color="#e8e8d7" stop-opacity="0"/></linearGradient>
      <radialGradient id="court-canopy"><stop stop-color="#f4f0cd" stop-opacity=".8"/><stop offset="1" stop-color="#b9c8a9" stop-opacity="0"/></radialGradient>
      <linearGradient id="court-robe" x2="1" y2="1"><stop stop-color="#313c36"/><stop offset="1" stop-color="#687365"/></linearGradient>
    </defs>
    <path fill="url(#court-air)" d="M0 0h1000v300H0z"/>
    <circle cx="865" cy="58" r="32" fill="#fff5d9" opacity=".65"/>
    <path d="M0 205Q150 147 270 191T530 178T790 187T1000 157V300H0Z" fill="#fff9e6" opacity=".48"/>
    <g stroke="#a3b2a5" fill="#d3dcd1" opacity=".23"><path d="M35 14h18v176H35zM45 4h-17v10h37V4zM947 5h14v181h-14z"/><path d="M0 185h183M895 181h105"/></g>
    <path d="M0 258L560 198 1000 246V300H0Z" fill="#cbd1bd" opacity=".46"/>
    <g fill="none" stroke="#b0b8a0" stroke-width="1" opacity=".4"><path d="M0 285L560 210 1000 269M128 300L565 207M400 300L572 211M733 300L581 212"/></g>
    <g data-scenery="platform">
      <path d="M804 127h103l79 158H683Z" fill="#d4d6c3"/>
      <path d="M805 127h101l-15-66h-68Z" fill="#e8e9d9" stroke="#aab39e"/>
      <path d="M835 124V77h46v47" fill="url(#court-cloud)" stroke="#b4b99d"/>
      <path d="M818 64h81M817 60h83M827 72v57M893 72v57" fill="none" stroke="#9ba68f"/>
      <g fill="none" stroke="#a4af98" opacity=".65"><path d="M797 143h120M785 164h143M769 190h171M750 220h204M725 254h243M804 130l-95 156M907 130l67 156"/></g>
      <path class="platform-light" d="M842 119V83h32v36Z" fill="#fff6c7" opacity=".52"/>
    </g>
    <g data-scenery="tree">
      <ellipse cx="352" cy="115" rx="234" ry="139" fill="url(#court-canopy)"/>
      <g fill="none" stroke="#8a9b7d" stroke-linecap="round" stroke-linejoin="round">
        <path d="M347 274q14-53 4-92l-8-48 8-62 6-42M350 190l-63-55-33-60M348 166l68-57 19-60M346 141l-51-49-18-48M352 113l38-38 10-47M287 135l-71-24-43-34M416 109l68-14 47-39M345 238l-36 38M354 244l43 31M329 260l-65 19M377 263l56 17" stroke-width="4"/>
        <path d="M254 75l-38-19M295 92l-48-6M390 75l49-1M484 95l20-39M351 72l-31-37M287 135l-8-34M416 109l8-24" stroke-width="2"/>
      </g>
      <g fill="#b7bd8c" opacity=".55"><ellipse cx="239" cy="74" rx="23" ry="7" transform="rotate(28 239 74)"/><ellipse cx="285" cy="51" rx="18" ry="7" transform="rotate(-40 285 51)"/><ellipse cx="417" cy="61" rx="22" ry="8" transform="rotate(-22 417 61)"/><ellipse cx="476" cy="85" rx="23" ry="7" transform="rotate(15 476 85)"/></g>
      <g class="court-sparks" fill="#fff9d7" stroke="#bdad6d" stroke-width="1"><circle cx="173" cy="77" r="3"/><circle cx="254" cy="75" r="3"/><circle cx="277" cy="44" r="2"/><circle cx="357" cy="30" r="4"/><circle cx="400" cy="28" r="2"/><circle cx="435" cy="49" r="3"/><circle cx="531" cy="56" r="3"/><circle cx="320" cy="35" r="2"/></g>
    </g>
    <g data-scenery="rong">
      <ellipse cx="713" cy="245" rx="30" ry="4" fill="#667363" opacity=".2"/>
      <path d="M702 113q-3-24 11-25 15 2 10 27l4 42h-30Z" fill="#3f4b43"/>
      <ellipse cx="713" cy="107" rx="8" ry="11" fill="#d6d1bb"/>
      <path d="M707 96l1-12h11l1 12" fill="#b3b7a5" stroke="#8e9b8d"/>
      <path d="M699 121l27 0 13 21 11 99q-37 8-75 0l12-99Z" fill="url(#court-robe)"/>
      <path d="M704 122l9 11 9-11-4 115h-12Z" fill="#f0edde"/>
      <path d="M696 132l-11 78M729 132l13 78M696 165h34" fill="none" stroke="#b5a16b" stroke-width="1.3"/>
      <path d="M696 166l-2 40M729 167l3 34" stroke="#b8a679" opacity=".6"/>
      <circle cx="687" cy="208" r="4" fill="none" stroke="#3e4841" stroke-width="2"/>
    </g>
    <g data-scenery="bell">
      <path d="M104 201q12 10 8 25" fill="none" stroke="#af9962" stroke-width="2"/>
      <path d="M104 236v-9q10-11 20 0v9" fill="none" stroke="#a48e53" stroke-width="2"/>
      <path d="M96 260q0-26 18-26t18 26l-4 10h-28Z" fill="#e6d9a1" fill-opacity=".7" stroke="#a48e53" stroke-width="1.5"/>
      <path d="M103 248l22 13M125 248l-22 13M101 267h26" stroke="#a48e53" stroke-width="1" fill="none"/>
      <circle cx="114" cy="273" r="3" fill="#ad965d"/>
    </g>
    <path d="M0 293q127-12 246 0t270-3 281 4 203-1v7H0Z" fill="#f5f1df" opacity=".55"/>
  </svg>`;
  return el;
}
