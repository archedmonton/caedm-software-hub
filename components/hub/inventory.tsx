"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
} from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { money, cents, statuses, type Subscription } from "@/lib/domain";
import { Empty, Status } from "@/components/hub/common";
import { Button } from "@/components/ui/button";
export function Inventory({ software }: { software: Subscription[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("current");
  const [team, setTeam] = useState("");
  const [category, setCategory] = useState("");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);
  const data = useMemo(
    () =>
      software.filter(
        (s) =>
          (status === "current"
            ? !["archived", "cancelled", "expired"].includes(s.status)
            : !status || s.status === status) &&
          (!team || s.team_id === team) &&
          (!category || s.category === category),
      ),
    [software, status, team, category],
  );
  const columns = useMemo<ColumnDef<Subscription>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Software",
        cell: ({ row }) => (
          <Link className="software-cell" href={`/software/${row.original.id}`}>
            <span className="software-mark">
              {row.original.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{row.original.name}</strong>
              <small>{row.original.vendors?.name}</small>
            </span>
          </Link>
        ),
      },
      {
        id: "department",
        accessorFn: (s) => s.teams?.name,
        header: "Department",
        cell: ({ row }) => (
          <>
            <span>{row.original.teams?.name}</span>
            <small>
              {row.original.profiles?.full_name || "Owner unassigned"}
            </small>
          </>
        ),
      },
      { accessorKey: "category", header: "Category" },
      {
        id: "cost",
        accessorFn: (s) => cents(s.amount),
        header: "Billing amount",
        cell: ({ row }) => (
          <>
            <strong>
              {money(cents(row.original.amount), row.original.currency)}{" "}
              <small className="inline">{row.original.currency}</small>
            </strong>
            <small>{row.original.billing_cycle.replaceAll("_", " ")}</small>
          </>
        ),
      },
      {
        accessorKey: "next_billing_date",
        header: "Next renewal",
        cell: ({ row }) =>
          row.original.purchase_type === "one_time"
            ? "One-time"
            : row.original.next_billing_date || "—",
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <Status value={row.original.status} />,
      },
      {
        id: "open",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            href={`/software/${row.original.id}`}
            aria-label={`View ${row.original.name}`}
          >
            <ArrowUpRight size={17} />
          </Link>
        ),
      },
    ],
    [],
  );
  // TanStack v8 manages mutable state; React Compiler is not enabled.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });
  return (
    <section className="panel">
      <div className="table-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="Search software"
            placeholder="Search software, department, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter software status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="current">Current software</option>
          <option value="">All statuses</option>
          {statuses.map((v) => (
            <option key={v} value={v}>
              {v.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter department"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
        >
          <option value="">All departments</option>
          {Array.from(
            new Map(software.map((s) => [s.team_id, s.teams?.name])).entries(),
          ).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {[...new Set(software.map((s) => s.category))].sort().map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      {table.getFilteredRowModel().rows.length ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        aria-sort={
                          header.column.getIsSorted() === "asc"
                            ? "ascending"
                            : header.column.getIsSorted() === "desc"
                              ? "descending"
                              : undefined
                        }
                      >
                        {header.column.getCanSort() ? (
                          <button
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                            <ArrowUpDown size={12} />
                          </button>
                        ) : (
                          flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              {table.getFilteredRowModel().rows.length} records · Page{" "}
              {table.getState().pagination.pageIndex + 1} of{" "}
              {table.getPageCount()}
            </span>
            <div>
              <select
                aria-label="Records per page"
                value={table.getState().pagination.pageSize}
                onChange={(e) => table.setPageSize(Number(e.target.value))}
              >
                {[10, 25, 50].map((n) => (
                  <option key={n} value={n}>
                    {n} per page
                  </option>
                ))}
              </select>
              <Button
                size="icon"
                variant="outline"
                aria-label="Previous page"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <ChevronLeft />
              </Button>
              <Button
                size="icon"
                variant="outline"
                aria-label="Next page"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <Empty
          title="No software matches"
          text="Try adjusting the filters, or add a software record."
          href="/software/new"
          action="Add software"
        />
      )}
    </section>
  );
}
