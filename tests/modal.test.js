import { showConfirmModal, showAlertModal } from '../shared/modal.js';

describe('shared modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves true when confirm is clicked', async () => {
    const promise = showConfirmModal({ message: 'Delete it?' });
    expect(document.querySelector('.custom-modal')).not.toBeNull();

    document.querySelector('.modal-confirm').click();

    await expect(promise).resolves.toBe(true);
    expect(document.querySelector('.custom-modal')).toBeNull();
  });

  it('resolves false when cancel is clicked', async () => {
    const promise = showConfirmModal({ message: 'Delete it?' });
    document.querySelector('.modal-cancel').click();

    await expect(promise).resolves.toBe(false);
    expect(document.querySelector('.custom-modal')).toBeNull();
  });

  it('resolves false when overlay is clicked', async () => {
    const promise = showConfirmModal({ message: 'Delete it?' });
    document.querySelector('.modal-overlay').click();

    await expect(promise).resolves.toBe(false);
    expect(document.querySelector('.custom-modal')).toBeNull();
  });

  it('resolves false on Escape key for confirm modal', async () => {
    const promise = showConfirmModal({ message: 'Delete it?' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    await expect(promise).resolves.toBe(false);
    expect(document.querySelector('.custom-modal')).toBeNull();
  });

  it('resolves on OK click for alert modal', async () => {
    const promise = showAlertModal({ message: 'Done.' });
    expect(document.querySelector('.custom-modal')).not.toBeNull();

    document.querySelector('.modal-confirm').click();

    await expect(promise).resolves.toBeUndefined();
    expect(document.querySelector('.custom-modal')).toBeNull();
  });

  it('resolves on Escape key for alert modal', async () => {
    const promise = showAlertModal({ message: 'Done.' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    await expect(promise).resolves.toBeUndefined();
    expect(document.querySelector('.custom-modal')).toBeNull();
  });
});
