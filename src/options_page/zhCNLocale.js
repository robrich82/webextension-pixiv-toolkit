import moment from 'moment';

export function defineZhCNLocale() {
  moment.defineLocale('zh_CN', {
    months: [
      '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'
    ],
    // Moment's weekdays are Sunday-first
    weekdays: [
      '星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'
    ],
    meridiem(hour, minute) {
      const hm = hour * 100 + minute;

      if (hm < 900) {
        return '早上';
      } else if (hm < 1130) {
        return '上午';
      } else if (hm < 1230) {
        return '中午';
      } else if (hm < 1800) {
        return '下午';
      } else {
        return '晚上';
      }
    }
  });
}
