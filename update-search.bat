@echo off
:: OBA Search Engine Index Automation
:: This script crawls, merges, and pushes updates to the repository.

echo [1/3] Crawling OnDeck (Authenticated)...
call npm run crawl:ondeck
if errorlevel 1 (
    echo ERROR: Crawl failed. Aborting.
    pause
    exit /b 1
)

echo [2/3] Merging search indexes...
call npm run merge-indexes
if errorlevel 1 (
    echo ERROR: Merge failed. Aborting.
    pause
    exit /b 1
)

echo [3/3] Syncing repository...
:: Stage all changes including data and code
git add .

:: Commit changes; skip if nothing new
git diff --cached --quiet && (
    echo No new data to commit.
) || (
    git commit -m "data: automatic update of search indexes"
)

:: Pull remote changes first; prefer our freshly-crawled data on conflict
git fetch origin
git rebase -X ours origin/main
if errorlevel 1 (
    echo ERROR: Rebase failed. Aborting rebase and exiting.
    git rebase --abort
    pause
    exit /b 1
)

echo Pushing updates...
git push
if errorlevel 1 (
    echo ERROR: Push failed.
    pause
    exit /b 1
)

echo.
echo Update process completed successfully.
pause