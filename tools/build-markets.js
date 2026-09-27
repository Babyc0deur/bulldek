// Génère markets.json en validant chaque code CFTC (Legacy + TFF) et chaque symbole Yahoo. Usage: node tools/build-markets.js
const fs = require('fs'), path = require('path');
const M = [
 ['Indices','sp500','S&P 500 E-Mini','13874A','ES=F'],['Indices','nasdaq-100','Nasdaq 100 E-Mini','209742','NQ=F'],
 ['Indices','dow-jones','Dow Jones 30 E-Mini','124603','YM=F'],['Indices','russell-2000','Russell 2000 E-Mini','239742','RTY=F'],
 ['Currencies','us-dollar','US Dollar (USD)','098662','DX-Y.NYB'],['Currencies','euro-fx','Euro Fx (EUR)','099741','6E=F'],
 ['Currencies','british-pound','British Pound (GBP)','096742','6B=F'],['Currencies','japanese-yen','Japanese Yen (JPY)','097741','6J=F'],
 ['Currencies','canadian-dollar','Canadian Dollar (CAD)','090741','6C=F'],['Currencies','swiss-franc','Swiss Franc (CHF)','092741','6S=F'],
 ['Currencies','australian-dollar','Australian Dollar (AUD)','232741','6A=F'],['Currencies','new-zealand-dollar','New Zealand Dollar (NZD)','112741','6N=F'],
 ['Crypto','bitcoin','Bitcoin (CME)','133741','BTC=F'],
 ['Bonds','30-year-t-bond','30-Year T-Bond','020601','ZB=F'],['Bonds','10-year-t-note','10-Year T-Note','043602','ZN=F'],
 ['Bonds','5-year-t-note','5-Year T-Note','044601','ZF=F'],['Bonds','2-year-t-note','2-Year T-Note','042601','ZT=F'],
 ['Energy','crude-oil','Crude Oil','067651','CL=F'],['Energy','heating-oil','Heating Oil','022651','HO=F'],
 ['Energy','gasoline-rbob','Gasoline RBOB','111659','RB=F'],['Energy','natural-gas','Natural Gas','023651','NG=F'],
 ['Metals','gold','Gold','088691','GC=F'],['Metals','silver','Silver','084691','SI=F'],['Metals','copper','Copper','085692','HG=F'],
 ['Metals','platinum','Platinum','076651','PL=F'],['Metals','palladium','Palladium','075651','PA=F'],
 ['Grains','wheat','Wheat SRW','001602','ZW=F'],['Grains','corn','Corn','002602','ZC=F'],['Grains','soybeans','Soybeans','005602','ZS=F'],
 ['Grains','soybean-meal','Soybean Meal','026603','ZM=F'],['Grains','soybean-oil','Soybean Oil','007601','ZL=F'],
 ['Softs','cotton','Cotton','033661','CT=F'],['Softs','coffee','Coffee','083731','KC=F'],['Softs','sugar','Sugar','080732','SB=F'],['Softs','cocoa','Cocoa','073732','CC=F'],
 ['Livestock','live-cattle','Live Cattle','057642','LE=F'],['Livestock','lean-hogs','Lean Hogs','054642','HE=F'],
];
const B='https://publicreporting.cftc.gov/resource/';
const j=async u=>(await fetch(u,{headers:{'User-Agent':'Mozilla/5.0'}})).json();
(async()=>{
  const out=[];
  for(const [group,slug,name,code,yahoo] of M){
    const w=encodeURIComponent(`cftc_contract_market_code='${code}'`);
    const leg=await j(`${B}6dca-aqww.json?$select=count(*)&$where=${w}`);
    const tff=await j(`${B}gpe5-46if.json?$select=count(*)&$where=${w}`);
    const dis=await j(`${B}72hh-3qpy.json?$select=count(*)&$where=${w}`);
    let y=0;try{const r=await j(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=1mo&interval=1d`);y=r.chart.result[0].timestamp.length}catch{}
    const l=+leg[0].count,t=+tff[0].count;
    console.log(l&&y?'OK ':'BAD',slug.padEnd(20),code,'legacy',l,'tff',t,'yahoo',y);
    if(l&&y)out.push({group,slug,name,code,yahoo,tff:t>0,disagg:+dis[0].count>0});
  }
  fs.writeFileSync(path.join(__dirname,'..','markets.json'),JSON.stringify(out,null,1));
  console.log(out.length+'/'+M.length+' marchés valides');
})();
