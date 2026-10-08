"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DecisionSaisie } from "../../../components/hors-ligne/DecisionSaisie";
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
  abandonner as abandonnerAncienne,
  aReprendre,
  lireFile,
  type Instantane,
} from "../../../lib/file-sauvegarde";
import {
  classeSaisie,
  iconeSaisie,
  MESSAGE_MEMOIRE,
  MESSAGE_SAISIE,
} from "../../../lib/hors-ligne/etats";
import {
  CODE_MODIFIEE_AILLEURS,
  CODE_NON_MODIFIABLE,
  decisionAuChargement,
  lister,
  mettreDeCote,
  purgerAutresUtilisateurs,
  type SaisieEnAttente,
} from "../../../lib/hors-ligne/file-temps";
import { obtenirMagasin } from "../../../lib/hors-ligne/magasins";
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
  /** Propriétaire des saisies gardées sur l'appareil (jamais rejouées pour un autre compte). */
  utilisateurId: string;
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
  const { feuille, unite, jours, joursClotures, activites, taches, modifiable, utilisateurId } =
    props;
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
  const s = useSauvegardeFeuille({
    feuilleId: feuille.id,
    utilisateurId,
    semaine: jours[0] ?? "",
    unite,
    construire,
  });

  function restaurer(i: Pick<Instantane, "rangees" | "valeurs">) {
    setValeurs(i.valeurs);
    setRangees(rangeesInitiales(feuille.lignes, taches, activites, i.rangees));
  }

  // Reprise d'une saisie restée sur l'appareil (coupure, fermeture de l'onglet).
  useEffect(() => {
    void reprendreSaisieLocale();
    // Une seule fois au montage : les props initiales suffisent.
  }, []);

  async function reprendreSaisieLocale() {
    // Ancienne file (localStorage, une clé par feuille) : reprise une fois, puis effacée.
    const ancienne = aReprendre(lireFile(stockageLocal(), feuille.id), {
      modifiable,
      modifieLe: feuille.modifie_le,
    });
    abandonnerAncienne(stockageLocal(), feuille.id);
    let e: SaisieEnAttente | undefined;
    try {
      const m = await obtenirMagasin();
      await purgerAutresUtilisateurs(m, utilisateurId);
      e = (await lister(m, utilisateurId)).find((x) => x.feuilleId === feuille.id);
      const decision = decisionAuChargement(e, { modifiable, modifieLe: feuille.modifie_le });
      if (e && (decision === "non_modifiable" || decision === "modifiee_ailleurs")) {
        const code = decision === "non_modifiable" ? CODE_NON_MODIFIABLE : CODE_MODIFIEE_AILLEURS;
        e = (await mettreDeCote(m, e.cle, "conflit", { code, message: "" })) ?? e;
        s.reprendre(e);
        return;
      }
    } catch {
      // Stockage indisponible : seule l'ancienne file peut encore servir.
    }
    if (e) {
      restaurer(e);
      setReprise(e.etat === "en_attente");
      s.reprendre(e);
    } else if (ancienne) {
      restaurer(ancienne);
      setReprise(true);
      s.modifier(ancienne);
    }
  }

  /** « Garder ma saisie » : elle revient dans la grille et repart. */
  async function renvoyerSaisie(e: SaisieEnAttente) {
    restaurer(e);
    await s.decider("renvoyer", e);
  }

  /** « Abandonner » : la grille revient à la version enregistrée sur le serveur. */
  async function abandonnerSaisie(e: SaisieEnAttente) {
    await s.decider("abandonner", e);
    setValeurs(valeursInitiales(feuille.lignes, unite));
    setRangees(rangeesInitiales(feuille.lignes, taches, activites));
    setReprise(false);
    router.refresh();
  }

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
      {s.deCote ? (
        <DecisionSaisie
          entree={s.deCote}
          libelleRangee={(cle) => rangees.find((r) => r.cle === cle)?.libelle}
          onRenvoyer={modifiable ? () => renvoyerSaisie(s.deCote as SaisieEnAttente) : undefined}
          onAbandonner={() => abandonnerSaisie(s.deCote as SaisieEnAttente)}
          libelleRenvoyer={
            s.deCote.motif?.code === CODE_MODIFIEE_AILLEURS ? "Garder ma saisie" : undefined
          }
          libelleAbandonner={
            s.deCote.motif?.code === CODE_MODIFIEE_AILLEURS
              ? "Garder la version enregistrée"
              : undefined
          }
        />
      ) : s.erreur ? (
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
          <p
            className={`mp-feuille__synchro mp-feuille__synchro--${classeSaisie(s.etat)}`}
            role="status"
          >
            <Icone nom={iconeSaisie(s.etat)} taille={18} />
            <span>
              {MESSAGE_SAISIE[s.etat]}
              {s.memoireSeule ? ` ${MESSAGE_MEMOIRE}` : ""}
            </span>
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
