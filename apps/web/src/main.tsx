import React from 'react';
import '@ant-design/v5-patch-for-react-19';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './shell.js';
import './styles.css';
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10000, refetchOnWindowFocus: true } },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#3868fa',
          colorText: '#243247',
          colorTextSecondary: '#8390a2',
          borderRadius: 9,
          fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
          controlHeight: 40,
        },
        components: {
          Button: { primaryShadow: '0 4px 12px #3868fa24' },
          Table: { headerBg: '#f8fafc', cellPaddingBlock: 18 },
        },
      }}
    >
      <AntApp>
        <QueryClientProvider client={client}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
