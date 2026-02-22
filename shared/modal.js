function createModal() {
  const modal = document.createElement('div');
  modal.className = 'custom-modal';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const content = document.createElement('div');
  content.className = 'modal-content';

  modal.appendChild(overlay);
  modal.appendChild(content);
  document.body.appendChild(modal);

  return { modal, overlay, content };
}

function removeModal(modal) {
  if (modal && modal.parentNode) {
    modal.parentNode.removeChild(modal);
  }
}

export function showConfirmModal({ message, confirmText = 'OK', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const { modal, overlay, content } = createModal();
    let closed = false;
    let escHandler;

    const close = (result) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', escHandler);
      removeModal(modal);
      resolve(result);
    };

    content.replaceChildren();

    const p = document.createElement('p');
    p.textContent = message;
    content.appendChild(p);

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'modal-buttons';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'modal-btn modal-confirm';
    confirmBtn.textContent = confirmText;

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-btn modal-cancel';
    cancelBtn.textContent = cancelText;

    buttonsDiv.appendChild(confirmBtn);
    buttonsDiv.appendChild(cancelBtn);
    content.appendChild(buttonsDiv);

    confirmBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('click', () => close(false));

    escHandler = (e) => {
      if (e.key === 'Escape') {
        close(false);
      }
    };
    document.addEventListener('keydown', escHandler);
  });
}

export function showAlertModal({ message, okText = 'OK' }) {
  return new Promise((resolve) => {
    const { modal, overlay, content } = createModal();
    let closed = false;
    let escHandler;

    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', escHandler);
      removeModal(modal);
      resolve();
    };

    content.replaceChildren();

    const p = document.createElement('p');
    p.textContent = message;
    content.appendChild(p);

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'modal-buttons';

    const okBtn = document.createElement('button');
    okBtn.className = 'modal-btn modal-confirm';
    okBtn.textContent = okText;

    buttonsDiv.appendChild(okBtn);
    content.appendChild(buttonsDiv);

    okBtn.addEventListener('click', close);
    overlay.addEventListener('click', close);

    escHandler = (e) => {
      if (e.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', escHandler);
  });
}

export function createLocalizedModalHelpers(getMessage) {
  return {
    showConfirmModal(message) {
      return showConfirmModal({
        message,
        confirmText: getMessage('ok', 'OK'),
        cancelText: getMessage('cancel', 'Cancel')
      });
    },
    showAlertModal(message) {
      return showAlertModal({
        message,
        okText: getMessage('ok', 'OK')
      });
    }
  };
}
