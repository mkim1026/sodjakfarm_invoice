# B2B 주문 시트 연결 (Apps Script)

웹앱의 **Sheet Orders** 메뉴가 구글시트의 B2B 주문을 읽어서 Invoice와 Delivery Note를 출력합니다.
시트가 원본입니다. 웹앱은 읽기만 하고 시트를 수정하지 않습니다.

## 1. 시트에 탭 추가 (처음 한 번)
기존 주문 구글시트를 열고 **파일 → 가져오기 → 업로드**에서 `Sodjakfarm_B2B_new_tabs.xlsx`를 선택합니다.
가져오기 방식은 **"새 시트 삽입"**으로 고릅니다. 그러면 아래 탭들이 추가됩니다.

| 탭 | 용도 |
|---|---|
| B2B Orders | 주문 입력. 상품 하나에 한 줄씩 |
| Customers | 고객, Price Group, 인보이스에 표시할 연락처 |
| Products | 드롭다운 상품명과 인보이스에 표시할 상품명 |
| Prices | 단가표. 새 단가는 새 줄로 추가 (Price Group + 새 Price Code + Effective From) |
| Invoices | 인보이스별 결제/DN 회수 관리. 번호를 붙이면 자동으로 줄이 추가됨 |

## 2. Apps Script 붙여넣기 (처음 한 번)
1. 시트에서 **확장 프로그램 → Apps Script**를 엽니다.
2. `Code.gs` 내용을 전부 붙여넣고, 맨 위 `TOKEN: 'CHANGE-ME'`를 나만 아는 단어로 바꾼 뒤 저장합니다.
3. **배포 → 새 배포 → 유형: 웹 앱**을 선택합니다.
   - 실행 계정: **나**
   - 액세스 권한: **모든 사용자**
4. 권한 승인 후 나오는 **웹 앱 URL**을 복사합니다.
5. 웹앱 **Settings → Google Sheet – B2B Orders**에 URL과 TOKEN을 입력하고 **Test Connection**을 누릅니다.
   이 설정은 기기(브라우저)마다 한 번씩 해야 합니다.

> `Code.gs`를 수정했다면 **배포 → 배포 관리 → 수정 → 새 버전**으로 다시 배포해야 반영됩니다.

## 3. 매일 쓰는 방법
1. **B2B Orders**에 주문을 입력합니다: 주문일, 고객▼, PO No., 상품▼, 주문수량.
2. 배송하는 날 **Delivered Qty**와 **Delivery Date**를 입력합니다.
3. 시트 메뉴 **Sodjakfarm → Assign invoice numbers**를 누릅니다.
   - 같은 배송일 + 고객 + PO 줄들이 하나의 번호를 받습니다 (`2026-TG-MMDD01`, `02` …).
   - 이미 붙은 번호는 바뀌지 않습니다. 번호가 붙는 순간 단가와 Price Code가 고정됩니다.
   - **번호는 절대 겹치지 않습니다.** Invoices 탭에 한 번 기록된 번호는 주문 줄을 지워도 다시 쓰지 않습니다.
   - Invoice No를 손으로 입력했는데 다른 주문과 겹치면 칸이 빨간색이 되고, 메뉴 실행 시 경고가 뜨고, 웹에서도 출력이 막힙니다.
4. 웹앱 **Sheet Orders**에서 날짜를 고르고 **Print** 또는 **Print All**을 누릅니다.

## 단가 규칙
- 고객에게는 **Price Group**만 지정합니다 (예: Dmart 지점들은 모두 `Dmart`).
- 각 주문 줄에는 **그 그룹에서 배송일 기준으로 가장 최신인 Price Code**가 자동으로 적용됩니다.
  Price Code 열에서 어떤 코드가 쓰였는지 볼 수 있습니다.
- 단가가 바뀌면 Prices에 새 줄을 추가합니다: 같은 Price Group, 새 Price Code, Effective From = 적용 시작일.
