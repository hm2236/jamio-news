(() => {try {const saved=localStorage.getItem('jamio-theme');if(saved==='light'||saved==='dark')document.documentElement.dataset.theme=saved;}catch{}})();
