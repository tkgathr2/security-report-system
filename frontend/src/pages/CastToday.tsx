import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Project {
  id: string;
  project_key: string;
  client_name_raw: string;
  client_name: string;
  work_date: string;
  work_name: string;
  location: string;
  status: string;
  unique_url: string;
  url_expires_at: string;
}

interface User {
  id: string;
  email: string;
  name: string;
}

export default function CastToday() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [dateOffset, setDateOffset] = useState(0);

  const fetchProjects = useCallback((offset: number) => {
    const token = localStorage.getItem('castToken');
    if (!token) {
      navigate('/cast/login');
      return;
    }

    setLoading(true);
    setError('');

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + offset);
    const dateStr = targetDate.toISOString().split('T')[0];

    fetch(`${API_BASE}/api/cast/today?date=${dateStr}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })
      .then((res) => {
        if (res.status === 401) {
          localStorage.removeItem('castToken');
          localStorage.removeItem('castUser');
          navigate('/cast/login');
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) {
          setUser(data.user);
          setProjects(data.projects);
          setDate(data.date);
        }
      })
      .catch(() => {
        setError('データの取得に失敗しました');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [navigate]);

  useEffect(() => {
    fetchProjects(dateOffset);
  }, [dateOffset, fetchProjects]);

  const handleLogout = async () => {
    const token = localStorage.getItem('castToken');
    if (token) {
      await fetch(`${API_BASE}/api/cast/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
    }
    localStorage.removeItem('castToken');
    localStorage.removeItem('castUser');
    navigate('/cast/login');
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`;
  };

  const getDateLabel = () => {
    if (dateOffset === 0) return '今日の現場';
    if (dateOffset === -1) return '昨日の現場';
    if (dateOffset === 1) return '明日の現場';
    return date ? `${formatDate(date)}の現場` : '現場';
  };

  const getNoProjectsLabel = () => {
    if (dateOffset === 0) return '今日の現場はありません';
    if (dateOffset === -1) return '昨日の現場はありません';
    if (dateOffset === 1) return '明日の現場はありません';
    return 'この日の現場はありません';
  };

  if (loading && !user) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <p>読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cast-container">
      <div className="cast-card wide">
        <div className="cast-header">
          <div className="cast-logo">ほうこちゃん</div>
          <button className="cast-logout" onClick={handleLogout}>
            ログアウト
          </button>
        </div>

        <h1>{getDateLabel()}</h1>
        {user && <p className="cast-user-name">{user.name} さん</p>}

        <div className="cast-date-nav">
          <button
            className="cast-date-nav-btn"
            onClick={() => setDateOffset(dateOffset - 1)}
            disabled={loading}
          >
            ◀
          </button>
          <span className="cast-date-current" onClick={() => setDateOffset(0)}>
            {date && formatDate(date)}
          </span>
          <button
            className="cast-date-nav-btn"
            onClick={() => setDateOffset(dateOffset + 1)}
            disabled={loading}
          >
            ▶
          </button>
        </div>

        {error && <p className="cast-message error">{error}</p>}

        {loading ? (
          <div className="cast-no-projects">
            <p>読み込み中...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="cast-no-projects">
            <p>{getNoProjectsLabel()}</p>
          </div>
        ) : (
          <div className="cast-projects">
            {projects.map((project) => (
              <div key={project.id} className="cast-project-card">
                <div className="cast-project-header">
                  <span className="cast-project-client">
                    {project.client_name || project.client_name_raw}
                  </span>
                </div>
                <h3 className="cast-project-name">{project.work_name}</h3>
                <p className="cast-project-location">{project.location}</p>
                {project.unique_url && (
                  <a 
                    href={`/report/${project.unique_url}?email=${encodeURIComponent(user?.email || '')}`}
                    className="cast-project-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    報告画面を開く
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
