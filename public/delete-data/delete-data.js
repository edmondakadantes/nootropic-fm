(function () {
  const form = document.getElementById('delete-form');
  const codeInput = document.getElementById('sync-code');
  const confirmBox = document.getElementById('confirm-erase');
  const submitBtn = document.getElementById('delete-btn');
  const statusEl = document.getElementById('delete-status');

  if (!form || !codeInput || !confirmBox || !submitBtn || !statusEl) return;

  function showStatus(kind, message) {
    statusEl.className = 'status ' + kind;
    statusEl.textContent = message;
  }

  // Also clear local browser storage if the user is on the same browser
  function clearLocalIfMatching(normalizedCode) {
    try {
      const savedSync = (localStorage.getItem('nootropic_fm_sync_code_v2') || '').toUpperCase();
      if (!savedSync || savedSync === normalizedCode) {
        localStorage.removeItem('nootropic_fm_profile_id_v1');
        localStorage.removeItem('nootropic_fm_profile_token_v2');
        localStorage.removeItem('nootropic_fm_sync_code_v2');
        localStorage.removeItem('nootropic_fm_profile_expires_v2');
      }
    } catch (_) {
      // ignore storage errors
    }
  }

  form.addEventListener('submit', async function (evt) {
    evt.preventDefault();
    const rawCode = String(codeInput.value || '').trim().toUpperCase();
    if (!rawCode) {
      showStatus('err', 'Please enter your NFM-XXXX-XXXX Sync Key.');
      return;
    }
    if (!confirmBox.checked) {
      showStatus('err', 'Please check the confirmation box to proceed with permanent deletion.');
      return;
    }

    submitBtn.disabled = true;
    const prevText = submitBtn.textContent;
    submitBtn.textContent = 'Erasing Profile & Session Data...';
    statusEl.className = 'status';
    statusEl.textContent = '';

    try {
      const res = await fetch('/api/identity/delete-by-sync-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ syncCode: rawCode, confirmErase: true }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        showStatus(
          'err',
          data.error || 'Unable to verify Sync Key. Please double-check the code and try again.'
        );
      } else {
        clearLocalIfMatching(data.syncCode || rawCode);
        codeInput.value = '';
        confirmBox.checked = false;
        showStatus(
          'ok',
          'Confirmed: Your Neural Pass (' +
            (data.deletedProfileId || 'profile') +
            ') and all associated session records have been permanently deleted.'
        );
      }
    } catch (_) {
      showStatus('err', 'Network error while contacting nootropic.fm. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = prevText;
    }
  });
})();
