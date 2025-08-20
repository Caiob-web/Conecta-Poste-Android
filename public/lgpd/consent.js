(function() {
  if (localStorage.getItem('lgpd-consent')) return;
  const banner = document.createElement('div');
  banner.innerHTML = `
    <div style="
      position:fixed; bottom:0; width:100%; background:#fff3cd; 
      padding:15px; text-align:center; box-shadow:0 -2px 6px rgba(0,0,0,0.1);
    ">
      Este site usa cookies e coleta dados de localização para mostrar postes. 
      <button id="lgpd-ok" style="
        margin-left:10px;padding:6px 12px; background:#28a745; color:white; border:none; border-radius:3px;
      ">Aceito</button>
      <a href="/lgpd/privacy.html" target="_blank" style="margin-left:8px;">Política de Privacidade</a>
    </div>
  `;
  document.body.appendChild(banner);
  document.getElementById('lgpd-ok').onclick = () => {
    localStorage.setItem('lgpd-consent','yes');
    document.body.removeChild(banner);
  };
})();
