import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { mainT } from './main-i18n'

/**
 * Нативное меню приложения (design D9): состав повторяет дефолтное меню
 * Electron, кроме Reload / Force Reload (в релизной сборке они не нужны);
 * Toggle Developer Tools остаётся для диагностики. Подписи задаются явно:
 * собственные подписи ролей в Electron всегда английские. Горячие клавиши
 * сохраняются ролями при смене языка (спека localization: нативное меню).
 */
export function rebuildMenu(): void {
  const t = mainT()
  const mac = process.platform === 'darwin'

  const appSubmenu: MenuItemConstructorOptions[] = [
    { role: 'about', label: t('menu.about') },
    { type: 'separator' },
    { role: 'hide', label: t('menu.hide') },
    { role: 'hideOthers', label: t('menu.hideOthers') },
    { role: 'unhide', label: t('menu.unhide') },
    { type: 'separator' },
    { role: 'quit', label: t('menu.quit') }
  ]

  const fileSubmenu: MenuItemConstructorOptions[] = [
    mac
      ? { role: 'close', label: t('menu.closeWindow') }
      : { role: 'quit', label: t('menu.quit') }
  ]

  const editSubmenu: MenuItemConstructorOptions[] = [
    { role: 'undo', label: t('menu.undo') },
    { role: 'redo', label: t('menu.redo') },
    { type: 'separator' },
    { role: 'cut', label: t('menu.cut') },
    { role: 'copy', label: t('menu.copy') },
    { role: 'paste', label: t('menu.paste') },
    ...(mac
      ? [{ role: 'pasteAndMatchStyle', label: t('menu.pasteAndMatchStyle') } satisfies MenuItemConstructorOptions]
      : []),
    { role: 'delete', label: t('menu.delete') },
    { type: 'separator' },
    { role: 'selectAll', label: t('menu.selectAll') }
  ]

  const viewSubmenu: MenuItemConstructorOptions[] = [
    { role: 'resetZoom', label: t('menu.resetZoom') },
    { role: 'zoomIn', label: t('menu.zoomIn') },
    { role: 'zoomOut', label: t('menu.zoomOut') },
    { type: 'separator' },
    { role: 'togglefullscreen', label: t('menu.fullscreen') },
    { type: 'separator' },
    { role: 'toggleDevTools', label: t('menu.devTools') }
  ]

  const windowSubmenu: MenuItemConstructorOptions[] = [
    { role: 'minimize', label: t('menu.minimize') },
    { role: 'zoom', label: t('menu.windowZoom') },
    { type: 'separator' },
    ...(mac
      ? [{ role: 'front', label: t('menu.front') } satisfies MenuItemConstructorOptions]
      : [{ role: 'close', label: t('menu.closeWindow') } satisfies MenuItemConstructorOptions])
  ]

  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [{ label: app.name, submenu: appSubmenu } satisfies MenuItemConstructorOptions]
      : []),
    { label: t('menu.file'), submenu: fileSubmenu },
    { label: t('menu.edit'), submenu: editSubmenu },
    { label: t('menu.view'), submenu: viewSubmenu },
    { label: t('menu.window'), submenu: windowSubmenu }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
