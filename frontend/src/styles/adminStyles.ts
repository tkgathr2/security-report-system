import React from 'react'
import { COLORS } from '../constants/admin'

export const styles: Record<string, React.CSSProperties> = {
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: COLORS.lightGray
  },
  loginContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: COLORS.secondary,
    backgroundImage: 'linear-gradient(135deg, #2C3E50 0%, #34495E 100%)'
  },
  loginBox: {
    backgroundColor: COLORS.white,
    padding: '50px 40px',
    borderRadius: '12px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    textAlign: 'center',
    maxWidth: '400px',
    width: '90%'
  },
    loginLogo: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: '20px'
    },
    loginLogoImage: {
      maxWidth: '280px',
      height: 'auto'
    },
  loginSubtitle: {
    margin: '0 0 10px 0',
    fontSize: '18px',
    color: COLORS.primary,
    fontWeight: 500
  },
  loginDesc: {
    margin: '0 0 30px 0',
    color: COLORS.darkGray,
    fontSize: '14px'
  },
  googleButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    width: '100%',
    backgroundColor: COLORS.white,
    color: COLORS.text,
    border: `1px solid ${COLORS.gray}`,
    padding: '14px 24px',
    fontSize: '16px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 500
  },
  googleIcon: {
    width: '20px',
    height: '20px'
  },
  app: {
    minHeight: '100vh',
    backgroundColor: COLORS.lightGray,
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    padding: '0 20px',
    height: '60px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px'
  },
  menuButton: {
    backgroundColor: 'transparent',
    border: 'none',
    color: COLORS.white,
    fontSize: '24px',
    cursor: 'pointer',
    padding: '5px 10px'
  },
    headerLogo: {
      display: 'flex',
      alignItems: 'center'
    },
    headerLogoImage: {
      height: '36px',
      width: 'auto'
    },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px'
  },
  adminEmail: {
    fontSize: '14px',
    opacity: 0.9
  },
  logoutButton: {
    backgroundColor: 'transparent',
    color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.3)',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  body: {
    display: 'flex',
    flex: 1
  },
  sidebar: {
    width: '240px',
    backgroundColor: COLORS.white,
    borderRight: `1px solid ${COLORS.gray}`,
    transition: 'width 0.3s, transform 0.3s',
    overflow: 'hidden',
    flexShrink: 0
  },
    sidebarClosed: {
      width: '0px',
      borderRight: 'none'
    },
        sidebarMobile: {
          position: 'fixed' as const,
          top: '60px',
          left: 0,
          bottom: 0,
          width: '240px',
          zIndex: 100,
          boxShadow: '2px 0 8px rgba(0, 0, 0, 0.1)'
        },
        sidebarMobileClosed: {
          transform: 'translateX(-100%)'
        },
        sidebarMobileOpen: {
          transform: 'translateX(0)'
        },
    sidebarOverlay: {
      position: 'fixed' as const,
      top: '60px',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      zIndex: 99
    },
    sidebarNav: {
    padding: '20px 0'
  },
  sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    padding: '14px 20px',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '15px',
    color: COLORS.text,
    textAlign: 'left' as const
  },
  sidebarItemActive: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    padding: '14px 20px',
    backgroundColor: COLORS.primary,
    border: 'none',
    cursor: 'pointer',
    fontSize: '15px',
    color: COLORS.white,
    textAlign: 'left' as const,
    borderLeft: `4px solid ${COLORS.primaryDark}`
  },
  sidebarIcon: {
    fontSize: '18px'
  },
  sidebarText: {
    fontWeight: 500
  },
  main: {
    flex: 1,
    padding: '24px',
    overflowY: 'auto' as const
  },
  pageTitle: {
    margin: '0 0 24px 0',
    fontSize: '24px',
    color: COLORS.secondary,
    fontWeight: 'bold'
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: '18px',
    color: COLORS.secondary,
    fontWeight: 600
  },
  error: {
    backgroundColor: '#FEE2E2',
    color: COLORS.danger,
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '20px',
    border: `1px solid ${COLORS.danger}`
  },
  card: {
    backgroundColor: COLORS.white,
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
  },
  cardTitle: {
    margin: '0 0 8px 0',
    fontSize: '18px',
    color: COLORS.secondary,
    fontWeight: 600
  },
  cardDesc: {
    margin: '0 0 20px 0',
    color: COLORS.darkGray,
    fontSize: '14px'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginBottom: '30px'
  },
  statCard: {
    backgroundColor: COLORS.white,
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    cursor: 'pointer',
    border: '2px solid transparent'
  },
  statCardActive: {
    borderColor: COLORS.primary
  },
  statIcon: {
    fontSize: '32px'
  },
  statContent: {},
  statValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: COLORS.secondary
  },
  statLabel: {
    fontSize: '14px',
    color: COLORS.darkGray
  },
  quickActions: {
    backgroundColor: COLORS.white,
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
  },
  actionButtons: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap' as const
  },
  actionButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 24px',
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: 500
  },
  actionIcon: {
    fontSize: '18px'
  },
  uploadArea: {
    position: 'relative' as const,
    border: `2px dashed ${COLORS.gray}`,
    borderRadius: '12px',
    padding: '40px 20px',
    textAlign: 'center' as const,
    transition: 'all 0.3s ease',
    backgroundColor: COLORS.white
  },
  uploadAreaDragging: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}10`,
    transform: 'scale(1.02)'
  },
  fileInput: {
    position: 'absolute' as const,
    opacity: 0,
    width: '100%',
    height: '100%',
    cursor: 'pointer'
  },
  uploadLabel: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '40px',
    border: `2px dashed ${COLORS.gray}`,
    borderRadius: '12px',
    cursor: 'pointer',
    backgroundColor: COLORS.lightGray
  },
  uploadIcon: {
    fontSize: '48px'
  },
  resultBox: {
    marginTop: '24px',
    padding: '20px',
    backgroundColor: '#E8F5E9',
    borderRadius: '8px',
    border: `1px solid ${COLORS.success}`
  },
  resultTitle: {
    margin: '0 0 16px 0',
    fontSize: '16px',
    color: COLORS.success,
    fontWeight: 600
  },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '12px'
  },
  resultItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px'
  },
  resultLabel: {
    fontSize: '12px',
    color: COLORS.darkGray
  },
  resultValue: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: COLORS.text
  },
  warningBox: {
    marginTop: '16px',
    padding: '12px',
    backgroundColor: '#FFF3E0',
    borderRadius: '6px',
    color: COLORS.warning,
    fontWeight: 500
  },
  infoBox: {
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#E3F2FD',
    borderRadius: '6px',
    color: '#1565C0',
    fontWeight: 500
  },
  tableContainer: {
    overflowX: 'auto' as const,
    WebkitOverflowScrolling: 'touch' as const,
    marginLeft: '-12px',
    marginRight: '-12px',
    paddingLeft: '12px',
    paddingRight: '12px'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const
  },
  th: {
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    padding: '14px 12px',
    textAlign: 'left' as const,
    fontSize: '14px',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const
  },
  sortableTh: {
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    padding: '14px 12px',
    textAlign: 'left' as const,
    fontSize: '14px',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    cursor: 'pointer',
    userSelect: 'none' as const
  },
  tr: {
    borderBottom: `1px solid ${COLORS.gray}`
  },
  td: {
    padding: '14px 12px',
    fontSize: '14px',
    color: COLORS.text
  },
  statusBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 500,
    color: COLORS.white
  },
  smallButton: {
    padding: '8px 14px',
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    minHeight: '36px'
  },
  linkButton: {
    padding: '8px 14px',
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    minHeight: '36px'
  },
  downloadButton: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    padding: '8px 14px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500
  },
  pdfPending: {
    color: COLORS.darkGray,
    fontSize: '13px'
  },
  emptyMessage: {
    textAlign: 'center' as const,
    color: COLORS.darkGray,
    padding: '40px'
  },
  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: 500
  },
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderRadius: '12px',
    width: '90%',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    borderBottom: `1px solid ${COLORS.gray}`
  },
  modalClose: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: COLORS.darkGray,
    padding: '4px 8px'
  },
  modal: {
    backgroundColor: COLORS.white,
    padding: '32px',
    borderRadius: '12px',
    width: '400px',
    maxWidth: '90%',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
  },
  modalTitle: {
    margin: '0 0 24px 0',
    fontSize: '20px',
    color: COLORS.secondary,
    fontWeight: 600
  },
  formGroup: {
    marginBottom: '20px'
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontSize: '14px',
    fontWeight: 500,
    color: COLORS.text
  },
  input: {
    width: '100%',
    padding: '12px',
    fontSize: '15px',
    border: `1px solid ${COLORS.gray}`,
    borderRadius: '8px',
    boxSizing: 'border-box' as const
  },
  searchInput: {
    width: '100%',
    maxWidth: '400px',
    padding: '12px 16px',
    fontSize: '15px',
    border: `1px solid ${COLORS.gray}`,
    borderRadius: '8px',
    boxSizing: 'border-box' as const
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '24px'
  },
  cancelButton: {
    backgroundColor: COLORS.white,
    color: COLORS.text,
    border: `1px solid ${COLORS.gray}`,
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '15px'
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    color: COLORS.secondary,
    border: `1px solid ${COLORS.secondary}`,
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: 500
  },
  staffImportResult: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8F5E9',
    border: `1px solid ${COLORS.success}`,
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '16px'
  },
  staffImportResultText: {
    color: COLORS.success,
    fontWeight: 500,
    fontSize: '14px'
  },
  staffImportResultClose: {
    backgroundColor: 'transparent',
    border: 'none',
    color: COLORS.success,
    fontSize: '20px',
    cursor: 'pointer',
    padding: '0 4px'
  },
  backButton: {
    backgroundColor: 'transparent',
    border: `1px solid ${COLORS.darkGray}`,
    color: COLORS.text,
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    marginBottom: '20px'
  },
  importDetailCard: {
    backgroundColor: COLORS.white,
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '24px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  importDetailTitle: {
    margin: '0 0 16px 0',
    fontSize: '18px',
    color: COLORS.text
  },
  importDetailInfo: {
    display: 'flex',
    gap: '24px',
    flexWrap: 'wrap' as const,
    marginBottom: '20px',
    fontSize: '14px',
    color: COLORS.darkGray
  },
  importDetailStats: {
    display: 'flex',
    gap: '32px'
  },
  importStatItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center'
  },
  importStatValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: COLORS.primary
  },
  importStatLabel: {
    fontSize: '12px',
    color: COLORS.darkGray,
    marginTop: '4px'
  },
  viewButton: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    padding: '8px 14px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    minHeight: '36px'
  },
  mobileCardList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px'
  },
  mobileCard: {
    backgroundColor: COLORS.white,
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    overflow: 'hidden'
  },
  mobileCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: COLORS.lightGray,
    borderBottom: `1px solid ${COLORS.gray}`
  },
  mobileCardDate: {
    fontSize: '14px',
    color: COLORS.darkGray,
    fontWeight: 500
  },
  mobileCardBody: {
    padding: '12px 16px'
  },
  mobileCardRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '8px 0',
    borderBottom: `1px solid ${COLORS.lightGray}`
  },
  mobileCardLabel: {
    fontSize: '13px',
    color: COLORS.darkGray,
    flexShrink: 0,
    marginRight: '12px'
  },
  mobileCardValue: {
    fontSize: '14px',
    color: COLORS.text,
    textAlign: 'right' as const,
    wordBreak: 'break-word' as const
  },
  mobileCardActions: {
    display: 'flex',
    gap: '8px',
    padding: '12px 16px',
    borderTop: `1px solid ${COLORS.gray}`
  },
  mobileActionButton: {
    flex: 1,
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    border: 'none',
    padding: '12px 16px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  mobileActionButtonPrimary: {
    flex: 1,
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    padding: '12px 16px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  alertBox: {
    display: 'flex',
    backgroundColor: '#FFF3CD',
    border: '1px solid #FFECB5',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '20px',
    gap: '12px'
  },
  alertIcon: {
    fontSize: '24px',
    color: COLORS.warning,
    flexShrink: 0
  },
  alertContent: {
    flex: 1
  },
  alertText: {
    margin: '8px 0',
    fontSize: '14px',
    color: COLORS.text
  },
  alertList: {
    margin: '8px 0',
    paddingLeft: '20px',
    fontSize: '14px',
    color: COLORS.text
  },
  alertButton: {
    backgroundColor: COLORS.warning,
    color: COLORS.white,
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    marginTop: '8px'
  },
  alertClientLink: {
    color: COLORS.primary,
    cursor: 'pointer',
    textDecoration: 'underline'
  },
  dateNavigation: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    marginBottom: '20px',
    padding: '12px',
    backgroundColor: COLORS.white,
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  dateNavButton: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    padding: '10px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  dateDisplay: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  dateInput: {
    padding: '10px 12px',
    fontSize: '16px',
    border: `1px solid ${COLORS.gray}`,
    borderRadius: '6px',
    cursor: 'pointer'
  },
  todayButton: {
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    border: 'none',
    padding: '10px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  searchContainer: {
    marginBottom: '20px',
    padding: '16px',
    backgroundColor: COLORS.white,
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  searchModeToggle: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px'
  },
  searchModeButton: {
    backgroundColor: COLORS.lightGray,
    color: COLORS.text,
    border: `1px solid ${COLORS.gray}`,
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  searchModeButtonActive: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: `1px solid ${COLORS.primary}`,
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  searchInputRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center'
  },
  searchFieldSelect: {
    padding: '10px 12px',
    fontSize: '14px',
    border: `1px solid ${COLORS.gray}`,
    borderRadius: '6px',
    backgroundColor: COLORS.white,
    cursor: 'pointer',
    minWidth: '120px'
  },
  projectSearchInput: {
    flex: 1,
    padding: '10px 12px',
    fontSize: '14px',
    border: `1px solid ${COLORS.gray}`,
    borderRadius: '6px'
  },
  searchClearButton: {
    backgroundColor: COLORS.lightGray,
    color: COLORS.text,
    border: `1px solid ${COLORS.gray}`,
    padding: '10px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  searchResultCount: {
    marginTop: '8px',
    fontSize: '14px',
    color: COLORS.darkGray
  },
  description: {
    margin: '0 0 20px 0',
    color: COLORS.darkGray,
    fontSize: '14px'
  }
}
