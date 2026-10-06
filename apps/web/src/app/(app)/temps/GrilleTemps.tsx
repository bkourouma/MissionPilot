"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  stockageLocal,
  useSauvegardeFeuille,
} from "../../../components/temps/useSauvegardeFeuille";
import { useAttenteRafraichissement } from "../../../components/formulaires/useAttenteRafraichissement";
import { Alerte } from "../../../components/ui/Alerte";
import { Bouton } from "../../../components/ui/Bouton";
import { CaseACocher } from "../../../components/ui/CaseACocher";
import { Icone } from "../../../components/ui/Icone";
import { api, messageErreur } from "../../../lib/api";
import {
  abandonner,
  aReprendre,
  lireFile,
  MESSAGE_SYNCHRO,
  type Instantane,
} from "../../../lib/file-sauvegarde";
import { libelleJourCourt, libelleJourLong } from "../../../lib/semaine";
import {
  cleActivite,
  cleCase,
  construireCharge,
  formaterValeur,
  NOM_UNITE,
  rangeeActivite,
  rangeesDepuisCles,
  rangeesInitiales,
  sommeAffichage,
  trierRangees,
  valeursInitiales,
  type ActiviteInterne,
  type Feuille,
  type Rangee,
  type TacheAffectee,
  type UniteSaisie,
} from "../../../lib/temps";

export interface GrilleTempsProps {
  feuille: Pick<Feuille, "id" | "statut" | "modifie_le" | "lignes">;
  unite: UniteSaisie;
  jours: string[];
  joursClotures: string[];
  activites: ActiviteInterne[];
  taches: TacheAffectee[];
  modifiable: boolean;
  libelleSoumettre: string;
}

/** Index des samedi et dimanche dans la semaine (lundi = 0). */
const WEEKEND = new Set([5, 6]);

function groupes(rangees: readonly Rangee[]): { nom: string; rangees: Rangee[] }[] {
  const g: { nom: string; rangees: Rangee[] }[] = [];
  for (const r of rangees) {
    const dernier = g[g.length - 1];
    if (dernier && dernier.nom === r.groupe) dernier.rangees.push(r);
    else g.push({ nom: r.groupe, rangees: [r] });
  }
  return g;
}

/**
 * Feuille de la semaine (TPS-01, TPS-02) : une rangée par tâche affectée ou activité interne,
 * une case par jour, dans l'unité du cabinet. Saisie mobile d'abord : clavier numérique,
 * cases de 44 px, week-end replié, barre d'envoi toujours visible.
 */
export function GrilleTemps(props: GrilleTempsProps) {
  const { feuille, unite, jours, joursClotures, activites, taches, modifiable } = props;
  const router = useRouter();
  const [rangees, setRangees] = useState<Rangee[]>(() =>
    rangeesInitiales(feuille.lignes, taches, activites),
  );
  const [valeurs, setValeurs] = useState<Record<string, string>>(() =>
    valeursInitiales(feuille.lignes, unite),
  );
  const [weekend, setWeekend] = useState(() =>
    feuille.lignes.some((l) => WEEKEND.has(jours.indexOf(l.date))),
  );
  const [reprise, setReprise] = useState(false);
  const [soumission, setSoumission] = useState<{ enCours: boolean; erreur: string | null }>({
    enCours: false,
    erreur: null,
  });
  const [attente, marquerAttente] = useAttenteRafraichissement(feuille.statut);
  const refErreur = useRef<HTMLDivElement>(null);

  const construire = useCallback(
    (i: Instantane) =>
      construireCharge(
        rangeesDepuisCles(i.rangees),
        i.valeurs,
        jours.filter((d) => !joursClotures.includes(d)),
        unite,
      ),
    [jours, joursClotures, unite],
  );
  const s = useSauvegardeFeuille({ feuilleId: feuille.id, construire });

  // Reprise d'une saisie restée sur l'appareil (coupure, fermeture de l'onglet).
  useEffect(() => {
    const i = aReprendre(lireFile(stockageLocal(), feuille.id), {
      modifiable,
      modifieLe: feuille.modifie_le,
    });
    if (!i) {
      if (!modifiable) abandonner(stockageLocal(), feuille.id);
      return;
    }
    setValeurs(i.valeurs);
    setRangees(rangeesInitiales(feuille.lignes, taches, activites, i.rangees));
    setReprise(true);
    s.modifier(i);
    // Une seule fois au montage : les props initiales suffisent.
  }, []);

  const clos = useMemo(() => new Set(joursClotures), [joursClotures]);
  const visibles = jours.filter((_, i) => weekend || !WEEKEND.has(i));

  function changer(cle: string, texte: string) {
    const suivantes = { ...valeurs, [cle]: texte };
    setValeurs(suivantes);
    s.modifier({
      feuilleId: feuille.id,
      rangees: rangees.map((r) => r.cle),
      valeurs: suivantes,
      modifieLe: Date.now(),
    });
  }

  function ajouterActivite(id: string) {
    const a = activites.find((x) => x.id === id);
    if (!a || rangees.some((r) => r.cle === cleActivite(id))) return;
    setRangees(trierRangees([...rangees, rangeeActivite(a)]));
  }

  async function soumettre() {
    setSoumission({ enCours: true, erreur: null });
    const ok = await s.enregistrerMaintenant();
    if (!ok) {
      setSoumission({
        enCours: false,
        erreur:
          "Le brouillon n'a pas pu être enregistré : corrigez la saisie ou attendez le retour du réseau, puis soumettez.",
      });
      refErreur.current?.focus();
      return;
    }
    try {
      await api.post(`/api/feuilles-temps/${encodeURIComponent(feuille.id)}/soumettre`);
      abandonner(stockageLocal(), feuille.id);
      marquerAttente();
      router.refresh();
      setSoumission({ enCours: false, erreur: null });
    } catch (e) {
      setSoumission({ enCours: false, erreur: messageErreur(e) });
      refErreur.current?.focus();
    }
  }

  const totalJour = (d: string) =>
    sommeAffichage(
      rangees.map((r) => valeurs[cleCase(r.cle, d)] ?? ""),
      unite,
    );
  const totalRangee = (r: Rangee) =>
    sommeAffichage(
      jours.map((d) => valeurs[cleCase(r.cle, d)] ?? ""),
      unite,
    );
  const totalSemaine = sommeAffichage(
    rangees.flatMap((r) => jours.map((d) => valeurs[cleCase(r.cle, d)] ?? "")),
    unite,
  );
  const ajoutables = activites.filter((a) => !rangees.some((r) => r.cle === cleActivite(a.id)));
  const weekendRempli = rangees.some((r) =>
    jours.some((d, i) => WEEKEND.has(i) && (valeurs[cleCase(r.cle, d)] ?? "").trim() !== ""),
  );

  return (
    <div className="mp-pile">
      {reprise ? (
        <Alerte tonalite="info" titre="Saisie restaurée">
          <p>
            Des modifications faites hors connexion ont été retrouvées sur cet appareil : elles sont
            en cours d&apos;envoi.
          </p>
        </Alerte>
      ) : null}
      {s.avertissements.map((a) => (
        <Alerte key={a.code + a.message} tonalite="attention" titre="Capacité dépassée">
          <p>{a.message}</p>
        </Alerte>
      ))}
      {s.erreur ? (
        <Alerte tonalite="danger" titre="Brouillon non enregistré">
          <p>{s.erreur}</p>
        </Alerte>
      ) : null}

      {modifiable ? (
        <CaseACocher
          libelle="Afficher le samedi et le dimanche"
          checked={weekend || weekendRempli}
          disabled={weekendRempli}
          aide={weekendRempli ? "Des temps sont saisis le week-end." : undefined}
          onChange={(e) => setWeekend(e.target.checked)}
        />
      ) : null}

      {rangees.length === 0 ? (
        <p className="mp-texte-doux">
          Aucune tâche affectée cette semaine. Ajoutez une activité interne ci-dessous si besoin.
        </p>
      ) : (
        <div className="mp-feuille">
          <table className="mp-feuille__table">
            <caption className="mp-visuellement-cache">
              {`Temps de la semaine, en ${NOM_UNITE[unite]}`}
            </caption>
            <thead>
              <tr>
                <th scope="col">Tâche ou activité</th>
                {(weekend || weekendRempli ? jours : visibles).map((d) => (
                  <th scope="col" key={d} className="mp-aligne-droite">
                    <span aria-hidden="true">{libelleJourCourt(d)}</span>
                    <span className="mp-visuellement-cache">{libelleJourLong(d)}</span>
                    {clos.has(d) ? (
                      <Icone nom="cadenas" taille={14} libelle="période clôturée" />
                    ) : null}
                  </th>
                ))}
                <th scope="col" className="mp-aligne-droite">
                  Total
                </th>
              </tr>
            </thead>
            {groupes(rangees).map((g) => (
              <tbody key={g.nom}>
                <tr className="mp-feuille__groupe">
                  <th scope="colgroup" colSpan={(weekend || weekendRempli ? 7 : 5) + 2}>
                    {g.nom}
                  </th>
                </tr>
                {g.rangees.map((r) => (
                  <tr key={r.cle}>
                    <th scope="row" className="mp-feuille__libelle">
                      {r.libelle}
                      {r.est_absence ? <span className="mp-texte-doux"> (absence)</span> : null}
                    </th>
                    {(weekend || weekendRempli ? jours : visibles).map((d) => {
                      const cle = cleCase(r.cle, d);
                      const erreur = s.erreursCases[cle];
                      const id = `case-${cle.replace(/[^a-z0-9]/gi, "")}`;
                      return (
                        <td key={d} data-jour={libelleJourCourt(d)} className="mp-feuille__case">
                          {modifiable && !clos.has(d) ? (
                            <>
                              <input
                                id={id}
                                className="mp-feuille__saisie"
                                type="text"
                                inputMode="decimal"
                                enterKeyHint="next"
                                autoComplete="off"
                                maxLength={6}
                                aria-label={`${libelleJourLong(d)}, ${r.libelle}, en ${NOM_UNITE[unite]}`}
                                aria-invalid={erreur ? true : undefined}
                                aria-describedby={erreur ? `${id}-erreur` : undefined}
                                value={valeurs[cle] ?? ""}
                                onChange={(e) => changer(cle, e.target.value)}
                              />
                              {erreur ? (
                                <span id={`${id}-erreur`} className="mp-feuille__erreur">
                                  {erreur}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="mp-feuille__valeur">{valeurs[cle] || "—"}</span>
                          )}
                        </td>
                      );
                    })}
                    <td data-jour="Total" className="mp-feuille__total">
                      {formaterValeur(totalRangee(r), unite)}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr>
                <th scope="row">Total du jour</th>
                {(weekend || weekendRempli ? jours : visibles).map((d) => (
                  <td key={d} data-jour={libelleJourCourt(d)} className="mp-feuille__total">
                    {formaterValeur(totalJour(d), unite)}
                  </td>
                ))}
                <td data-jour="Semaine" className="mp-feuille__total">
                  <strong>{formaterValeur(totalSemaine, unite)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {modifiable && ajoutables.length > 0 ? (
        <AjoutActivite activites={ajoutables} onAjouter={ajouterActivite} />
      ) : null}

      {modifiable ? (
        <div className="mp-feuille__barre">
          <p className={`mp-feuille__synchro mp-feuille__synchro--${s.etat}`} role="status">
            <Icone
              nom={s.etat === "hors_ligne" ? "nuage" : s.etat === "refuse" ? "attention" : "succes"}
              taille={18}
            />
            <span>{MESSAGE_SYNCHRO[s.etat]}</span>
          </p>
          <p className="mp-feuille__semaine">
            Semaine : <strong>{formaterValeur(totalSemaine, unite)}</strong>
          </p>
          {soumission.erreur ? (
            <div ref={refErreur} tabIndex={-1} className="mp-pleine-largeur">
              <Alerte tonalite="danger" titre="Soumission impossible">
                <p>{soumission.erreur}</p>
              </Alerte>
            </div>
          ) : null}
          <Bouton
            icone="envoyer"
            chargement={soumission.enCours || attente}
            texteChargement="Soumission…"
            disabled={totalSemaine === 0}
            onClick={soumettre}
          >
            {props.libelleSoumettre}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}

function AjoutActivite({
  activites,
  onAjouter,
}: {
  activites: ActiviteInterne[];
  onAjouter: (id: string) => void;
}) {
  const [choix, setChoix] = useState("");
  return (
    <div className="mp-ligne-action">
      <div className="mp-champ">
        <label className="mp-champ__libelle" htmlFor="ajout-activite">
          Ajouter une activité interne
        </label>
        <select
          id="ajout-activite"
          className="mp-champ__controle mp-select"
          value={choix}
          onChange={(e) => setChoix(e.target.value)}
        >
          <option value="">Choisir une activité…</option>
          {activites.map((a) => (
            <option key={a.id} value={a.id}>
              {a.libelle}
            </option>
          ))}
        </select>
      </div>
      <Bouton
        variante="secondaire"
        icone="plus"
        disabled={!choix}
        onClick={() => {
          onAjouter(choix);
          setChoix("");
        }}
      >
        Ajouter
      </Bouton>
    </div>
  );
}
