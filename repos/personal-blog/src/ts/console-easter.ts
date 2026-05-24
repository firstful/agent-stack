export function initConsoleEaster(): void {
  setTimeout(() => {
    const styles = [
      'color: #bea88b',
      'font-size: 16px',
      'font-weight: bold',
      'padding: 8px',
    ].join(';');

    console.log('%c  sutliff  ', styles);
    console.log('%cHey, thanks for peeking under the hood!', 'color: #a38256; font-size: 13px;');
    console.log(
      '%cThis site is built with MkDocs + Material. The source is at github.com/reedsutliff',
      'color: #888; font-size: 11px;'
    );
  }, 100);
}
