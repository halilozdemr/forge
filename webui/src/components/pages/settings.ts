import { addToast } from '../shared/toast';
import { getAppContext } from '../../api/context';

export function SettingsPage() {
  const container = document.createElement('div');
  container.className = 'settings-page';

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Settings</h1>
        <p class="page-subtitle">Configure Forge integrations and preferences</p>
      </div>
    </div>

    <div class="settings-container">
      <!-- Telegram Settings Section -->
      <div class="card settings-card">
        <div class="settings-header">
          <h2 class="settings-title">Telegram Notifications</h2>
          <p class="settings-subtitle">Send real-time notifications to Telegram when pipelines start, complete, or fail</p>
        </div>

        <form id="telegram-form" class="settings-form">
          <div class="form-group">
            <label for="bot-token" class="form-label">Bot Token</label>
            <input
              type="password"
              id="bot-token"
              name="botToken"
              placeholder="123456:ABC-DEF..."
              class="form-input"
              autocomplete="off"
              required
            />
            <p class="form-help">Create a bot via <a href="https://t.me/BotFather" target="_blank">BotFather</a> to get your token</p>
          </div>

          <div class="form-group">
            <label for="chat-id" class="form-label">Chat ID</label>
            <input
              type="text"
              id="chat-id"
              name="chatId"
              placeholder="123456789"
              class="form-input"
              required
            />
            <p class="form-help">Your Telegram user ID or group ID (numeric, can be negative for groups)</p>
          </div>

          <div class="form-actions">
            <button type="button" id="test-btn" class="btn btn-secondary">Test Connectivity</button>
            <button type="submit" class="btn btn-primary">Save Configuration</button>
          </div>

          <div id="form-message" class="form-message" style="display: none;"></div>
        </form>

        <div id="telegram-status" class="telegram-status" style="display: none;"></div>
      </div>
    </div>
  `;

  const form = container.querySelector('#telegram-form') as HTMLFormElement;
  const testBtn = container.querySelector('#test-btn') as HTMLButtonElement;
  const formMessage = container.querySelector('#form-message') as HTMLElement;
  const telegramStatus = container.querySelector('#telegram-status') as HTMLElement;
  const botTokenInput = container.querySelector('#bot-token') as HTMLInputElement;
  const chatIdInput = container.querySelector('#chat-id') as HTMLInputElement;

  // Load existing configuration
  loadTelegramConfig();

  // Test connectivity
  testBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    await testTelegramConnection();
  });

  // Save configuration
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveTelegramConfig();
  });

  async function loadTelegramConfig() {
    try {
      const context = await getAppContext();
      const response = await fetch(
        `/v1/telegram/config?companyId=${context.companyId}`
      );

      if (response.ok) {
        const data = await response.json() as { configured?: boolean; updatedAt?: string };
        if (data.configured) {
          telegramStatus.innerHTML = `
            <div class="status-success">
              <span class="status-icon">✓</span>
              <div>
                <p class="status-title">Telegram configured</p>
                <p class="status-time">Last updated: ${new Date(data.updatedAt || new Date()).toLocaleDateString()}</p>
              </div>
            </div>
          `;
          telegramStatus.style.display = 'block';
        }
      }
    } catch (error) {
      console.warn('Could not load Telegram config:', error);
    }
  }

  async function testTelegramConnection() {
    const botToken = botTokenInput.value.trim();
    const chatId = chatIdInput.value.trim();

    if (!botToken || !chatId) {
      showMessage('Please enter both bot token and chat ID', 'error');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';

    try {
      const context = await getAppContext();
      const response = await fetch('/v1/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: context.companyId,
          botToken,
          chatId,
        }),
      });

      const data = await response.json() as { success?: boolean; message?: string; error?: string; details?: string };

      if (response.ok && data.success) {
        showMessage(
          `${data.message}\n${data.details || ''}`,
          'success'
        );
      } else {
        showMessage(
          `${data.error || data.message}\n${data.details || ''}`,
          'error'
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showMessage(`Connection test failed: ${errorMessage}`, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connectivity';
    }
  }

  async function saveTelegramConfig() {
    const botToken = botTokenInput.value.trim();
    const chatId = chatIdInput.value.trim();

    if (!botToken || !chatId) {
      showMessage('Please enter both bot token and chat ID', 'error');
      return;
    }

    try {
      const context = await getAppContext();
      const response = await fetch('/v1/telegram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: context.companyId,
          botToken,
          chatId,
        }),
      });

      const data = await response.json() as { success?: boolean; message?: string; error?: string };

      if (response.ok && data.success) {
        showMessage('Telegram configuration saved successfully', 'success');
        addToast('Your Telegram settings have been updated', 'success');
        // Reload config display
        loadTelegramConfig();
      } else {
        showMessage(data.error || 'Failed to save configuration', 'error');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showMessage(`Failed to save: ${errorMessage}`, 'error');
    }
  }

  function showMessage(message: string, type: 'success' | 'error') {
    formMessage.textContent = message;
    formMessage.className = `form-message form-message-${type}`;
    formMessage.style.display = 'block';

    if (type === 'success') {
      setTimeout(() => {
        formMessage.style.display = 'none';
      }, 5000);
    }
  }

  return container;
}
